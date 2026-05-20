const SERVICE: &str = "com.usmcc.publicity-helper";
const ACCOUNT: &str = "anthropic-api-key";

pub fn get_api_key() -> Option<String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).ok()?;
    entry.get_password().ok()
}

pub fn set_api_key(key: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    entry.set_password(key).map_err(|e| e.to_string())
}

pub fn has_api_key() -> bool {
    get_api_key().is_some()
}
