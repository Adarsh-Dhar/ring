#!/bin/bash
# Pre-commit secret scanning script
# Checks for common secret patterns before committing

set -e

echo "Scanning for secrets..."

# Patterns to check for
PATTERNS=(
  "sk_[a-zA-Z0-9]{32,}"          # Stripe keys
  "AIza[0-9A-Za-z\\-_]{35}"       # Google API keys
  "AKIA[0-9A-Z]{16}"             # AWS access keys
  "[a-zA-Z0-9._-]*@{1}github\.com"  # Potential GitHub tokens in URLs
  "AUTH_SECRET\s*="              # Our app's AUTH_SECRET
  "TOKEN_ENC_KEY\s*="            # Our app's TOKEN_ENC_KEY
  "TWILIO_ACCOUNT_SID\s*="      # Twilio SID
  "TWILIO_AUTH_TOKEN\s*="       # Twilio token
  "RING_HMAC_KEY\s*="            # Ring HMAC key
  "password\s*=\s*['\"]"         # Generic password assignments
  "api[_-]?key\s*=\s*['\"]"     # Generic API key assignments
)

FOUND=0

# Only scan source files, not .env files (those are already excluded by git)
for pattern in "${PATTERNS[@]}"; do
  if git diff --cached --name-only | grep -E '\.(ts|tsx|js|jsx|json)$' | xargs grep -E "$pattern" 2>/dev/null; then
    echo "⚠️  Potential secret found matching pattern: $pattern"
    FOUND=1
  fi
done

# Check for .env files that might be accidentally staged
if git diff --cached --name-only | grep -E '\.env$'; then
  echo "⚠️  .env file is staged. This should not be committed."
  echo "   Use .env.example for templates and keep real .env files in .gitignore"
  FOUND=1
fi

if [ $FOUND -eq 1 ]; then
  echo ""
  echo "❌ Secrets detected in staged files. Please remove them before committing."
  echo "   If these are false positives, use 'git commit --no-verify' to bypass."
  exit 1
fi

echo "✅ No secrets detected in staged files"
