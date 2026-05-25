pub const SYSTEM_PROMPT: &str = "You are a science communicator for the US Muon Collider Collaboration (USMCC). \
You translate physics papers into accurate, engaging publicity copy for non-expert audiences.\n\n\
Rules you NEVER break:\n\
- Use only facts present in the inputs. Do not invent results, numbers, collaborators, or affiliations.\n\
- Credit the author list or collaboration exactly as provided.\n\
- No hype words (\"revolutionary\", \"groundbreaking\", \"game-changing\").\n\
- No formulas, no LaTeX, no jargon left undefined for general audiences.\n\
- Output only the requested text — no preamble, no explanation, no markdown fences.";

pub fn twitter_prompt(title: &str, authors: &str, abstract_: &str, link: &str) -> String {
    format!(
        "Write a single Twitter/X post for a USMCC Featured Paper.\n\
        Constraints: ≤ 280 characters including the link, one emoji maximum, at most 2 hashtags.\n\
        Open the post with the phrase \"USMCC Featured Paper:\" (or a close natural variant) so readers know this is the collaboration spotlighting a publication.\n\
        End with this link: {link}\n\n\
        Title: {title}\n\
        Authors: {authors}\n\
        Abstract: {abstract_}"
    )
}

pub fn twitter_thread_prompt(title: &str, authors: &str, abstract_: &str, link: &str) -> String {
    format!(
        "Write a Twitter/X thread (2–5 tweets) about a USMCC Featured Paper.\n\
        Each tweet must be ≤ 280 characters. Separate tweets with a blank line and a tweet number like \"1/\".\n\
        Tweet 1 must explicitly identify this as a USMCC Featured Paper.\n\
        The last tweet must include this link: {link}\n\n\
        Title: {title}\n\
        Authors: {authors}\n\
        Abstract: {abstract_}"
    )
}

pub fn bluesky_prompt(title: &str, authors: &str, abstract_: &str, link: &str) -> String {
    format!(
        "Write a single Bluesky post for a USMCC Featured Paper.\n\
        Constraints: ≤ 300 characters, no hashtags, end with this link: {link}\n\
        Open with \"USMCC Featured Paper:\" (or a close natural variant) so readers know this is the collaboration spotlighting a publication.\n\n\
        Title: {title}\n\
        Authors: {authors}\n\
        Abstract: {abstract_}"
    )
}

pub fn linkedin_prompt(title: &str, authors: &str, abstract_: &str, link: &str) -> String {
    format!(
        "Write a LinkedIn post for a USMCC Featured Paper.\n\
        Constraints: 100–200 words, professional tone, no emoji.\n\
        Begin with a clear \"USMCC Featured Paper:\" framing so the post is immediately identifiable as collaboration-spotlighted work.\n\
        End with the link and author credit.\n\
        Link: {link}\n\n\
        Title: {title}\n\
        Authors: {authors}\n\
        Abstract: {abstract_}"
    )
}

pub fn plain_summary_prompt(title: &str, authors: &str, abstract_: &str) -> String {
    format!(
        "Write a plain-language summary of this physics paper for a general public audience.\n\
        Constraints: 120–180 words. Define any physics jargon. No formulas. No LaTeX.\n\n\
        Title: {title}\n\
        Authors: {authors}\n\
        Abstract: {abstract_}"
    )
}
