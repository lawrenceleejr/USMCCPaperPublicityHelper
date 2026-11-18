//! A small HTTP/1.1 server for the local page: one thread per connection,
//! keep-alive, nothing else. It replaces tiny_http, whose shared thread pool
//! could leave a new connection queued behind an idle keep-alive one, so a
//! page load sometimes stalled for seconds (or for good) on its scripts.
//!
//! The API is the part of tiny_http the server used: `Request` (url, method,
//! headers, body reader, respond) and `Response` (bytes, status, headers).

use std::io::{self, BufRead, BufReader, Cursor, Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::time::Duration;

const MAX_HEAD: usize = 64 * 1024; // request line and headers
const MAX_BODY: usize = 120 * 1024 * 1024; // larger than any upload the API accepts
const IDLE: Duration = Duration::from_secs(15); // a kept-alive connection with nothing to say

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Method {
    Get,
    Head,
    Post,
    Put,
    Delete,
    Options,
    Other(String),
}

impl Method {
    fn parse(s: &str) -> Method {
        match s {
            "GET" => Method::Get,
            "HEAD" => Method::Head,
            "POST" => Method::Post,
            "PUT" => Method::Put,
            "DELETE" => Method::Delete,
            "OPTIONS" => Method::Options,
            other => Method::Other(other.to_string()),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Header {
    pub field: String,
    pub value: String,
}

impl Header {
    pub fn from_bytes(field: &[u8], value: &[u8]) -> Result<Header, ()> {
        let field = std::str::from_utf8(field).map_err(|_| ())?;
        let value = std::str::from_utf8(value).map_err(|_| ())?;
        if field.is_empty() || field.contains([':', '\r', '\n']) || value.contains(['\r', '\n']) {
            return Err(());
        }
        Ok(Header { field: field.to_string(), value: value.to_string() })
    }
}

pub struct Response {
    status: u16,
    headers: Vec<Header>,
    body: Vec<u8>,
}

impl Response {
    pub fn from_data(body: Vec<u8>) -> Response {
        Response { status: 200, headers: Vec::new(), body }
    }
    pub fn with_status_code(mut self, status: u16) -> Response {
        self.status = status;
        self
    }
    pub fn with_header(mut self, h: Header) -> Response {
        // the connection's own headers are ours to set
        if !["content-length", "connection", "transfer-encoding"].contains(&h.field.to_ascii_lowercase().as_str()) {
            self.headers.push(h);
        }
        self
    }
}

pub struct Request {
    method: Method,
    url: String,
    headers: Vec<Header>,
    body: Cursor<Vec<u8>>,
    out: Option<TcpStream>,
    keep_alive: bool,
}

impl Request {
    pub fn url(&self) -> &str {
        &self.url
    }
    pub fn method(&self) -> &Method {
        &self.method
    }
    pub fn headers(&self) -> &[Header] {
        &self.headers
    }
    pub fn as_reader(&mut self) -> &mut dyn Read {
        &mut self.body
    }
    pub fn respond(mut self, r: Response) -> io::Result<()> {
        let out = self.out.take();
        match out {
            Some(s) => write_response(&s, &r, self.method == Method::Head, self.keep_alive),
            None => Ok(()),
        }
    }
}

impl Drop for Request {
    // a handler that never answered: say so, rather than leave the page waiting
    fn drop(&mut self) {
        if let Some(s) = self.out.take() {
            let r = Response::from_data(b"{\"error\":\"no answer\"}".to_vec()).with_status_code(500);
            let _ = write_response(&s, &r, false, false);
        }
    }
}

fn reason(code: u16) -> &'static str {
    match code {
        200 => "OK",
        204 => "No Content",
        304 => "Not Modified",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        411 => "Length Required",
        413 => "Payload Too Large",
        431 => "Request Header Fields Too Large",
        500 => "Internal Server Error",
        501 => "Not Implemented",
        502 => "Bad Gateway",
        _ => match code / 100 {
            2 => "OK",
            3 => "Redirect",
            4 => "Client Error",
            _ => "Server Error",
        },
    }
}

fn write_response(mut s: &TcpStream, r: &Response, head_only: bool, keep_alive: bool) -> io::Result<()> {
    let mut head = format!("HTTP/1.1 {} {}\r\nContent-Length: {}\r\nConnection: {}\r\n", r.status, reason(r.status), r.body.len(), if keep_alive { "keep-alive" } else { "close" });
    for h in &r.headers {
        head.push_str(&h.field);
        head.push_str(": ");
        head.push_str(&h.value);
        head.push_str("\r\n");
    }
    head.push_str("\r\n");
    s.write_all(head.as_bytes())?;
    if !head_only {
        s.write_all(&r.body)?;
    }
    s.flush()
}

pub struct Server {
    listener: TcpListener,
}

impl Server {
    pub fn http<A: ToSocketAddrs>(addr: A) -> io::Result<Server> {
        Ok(Server { listener: TcpListener::bind(addr)? })
    }
    pub fn port(&self) -> u16 {
        self.listener.local_addr().map(|a| a.port()).unwrap_or(0)
    }
    /// Answer every request with `handle`, each connection on its own thread.
    pub fn serve<F: Fn(Request) + Send + Sync + 'static>(self, handle: F) {
        let handle = std::sync::Arc::new(handle);
        for stream in self.listener.incoming().flatten() {
            let handle = handle.clone();
            std::thread::spawn(move || connection(stream, &*handle));
        }
    }
}

fn connection(stream: TcpStream, handle: &(dyn Fn(Request) + Send + Sync)) {
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(IDLE));
    let Ok(read_half) = stream.try_clone() else { return };
    let mut reader = BufReader::new(read_half);
    loop {
        match read_request(&mut reader) {
            Ok(Some((method, url, headers, body, keep_alive))) => {
                let Ok(out) = stream.try_clone() else { return };
                handle(Request { method, url, headers, body: Cursor::new(body), out: Some(out), keep_alive });
                if !keep_alive {
                    return;
                }
            }
            Ok(None) => return, // closed, or idle too long
            Err(code) => {
                let r = Response::from_data(Vec::new()).with_status_code(code);
                let _ = write_response(&stream, &r, false, false);
                return;
            }
        }
    }
}

type Parsed = (Method, String, Vec<Header>, Vec<u8>, bool);

// One request off the connection; Ok(None) when the client is done.
fn read_request(r: &mut BufReader<TcpStream>) -> Result<Option<Parsed>, u16> {
    let mut line = String::new();
    let mut total = 0usize;
    // the request line (skipping blank lines between requests)
    loop {
        line.clear();
        match r.by_ref().take((MAX_HEAD - total) as u64).read_line(&mut line) {
            Ok(0) => return Ok(None),
            Ok(n) => total += n,
            Err(_) => return Ok(None),
        }
        if !line.trim().is_empty() {
            break;
        }
        if total >= MAX_HEAD {
            return Err(431);
        }
    }
    let mut parts = line.split_whitespace();
    let (Some(m), Some(url), Some(version)) = (parts.next(), parts.next(), parts.next()) else { return Err(400) };
    let http10 = version == "HTTP/1.0";
    if !http10 && version != "HTTP/1.1" {
        return Err(400);
    }
    let mut headers = Vec::new();
    loop {
        let mut h = String::new();
        match r.by_ref().take((MAX_HEAD.saturating_sub(total)) as u64).read_line(&mut h) {
            Ok(0) => return Err(400),
            Ok(n) => total += n,
            Err(_) => return Ok(None),
        }
        if !h.ends_with('\n') {
            return Err(431);
        }
        let h = h.trim_end_matches(['\r', '\n']);
        if h.is_empty() {
            break;
        }
        let Some((k, v)) = h.split_once(':') else { return Err(400) };
        headers.push(Header { field: k.trim().to_string(), value: v.trim().to_string() });
    }
    let get = |name: &str| headers.iter().find(|h| h.field.eq_ignore_ascii_case(name)).map(|h| h.value.to_ascii_lowercase());
    if get("transfer-encoding").is_some_and(|v| v != "identity") {
        return Err(411); // the page always sends a length
    }
    let len: usize = match get("content-length") {
        Some(v) => v.parse().map_err(|_| 400u16)?,
        None => 0,
    };
    if len > MAX_BODY {
        return Err(413);
    }
    let mut body = vec![0u8; len];
    if r.read_exact(&mut body).is_err() {
        return Ok(None);
    }
    let conn = get("connection").unwrap_or_default();
    let keep_alive = if http10 { conn.contains("keep-alive") } else { !conn.contains("close") };
    Ok(Some((Method::parse(m), url.to_string(), headers, body, keep_alive)))
}
