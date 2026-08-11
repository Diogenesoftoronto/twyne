# Constants for the prompt-learning-sdk module.


# Delimiters for template variables
START_DELIM = "{"
END_DELIM = "}"

SUPPORTED_MODELS = [
    "o1",
    "o3",
    "gpt-4o",
    "gpt-4",
    "gpt-3.5-turbo",
    "gpt-3.5",
    # twyne extension (see TOOLS_PATCHES.md): modern models kept here so the
    # SDK accepts them. When OPENAI_BASE_URL is set (to e.g. a Portkey
    # gateway), the OpenAI-shaped client routes any of these to Claude or
    # Gemini upstream without changing the SDK.
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "o3-mini",
    "o4-mini",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-3.1-pro",
    "gemini-3.6-flash",
]
