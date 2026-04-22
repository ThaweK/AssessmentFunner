#!/bin/bash
# AssessmentFunner — Mac launcher
# Double-click this file to start the app

cd "$(dirname "$0")"

# Ensure python3 is available
if ! command -v python3 &>/dev/null; then
    echo "Python 3 not found. Installing..."
    if command -v brew &>/dev/null; then
        brew install python3
    else
        echo "Homebrew not found. Installing Homebrew first..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"
        brew install python3
    fi

    if ! command -v python3 &>/dev/null; then
        echo ""
        echo "ERROR: Could not install Python 3 automatically."
        echo "Please install it manually from https://www.python.org/downloads/"
        read -rp "Press Enter to exit..."
        exit 1
    fi
    echo "Python 3 installed successfully."
fi

PORT=8000

# Find an available port
while lsof -i :"$PORT" >/dev/null 2>&1; do
    PORT=$((PORT + 1))
done

echo "Starting AssessmentFunner on http://localhost:$PORT"
echo "Press Ctrl+C to stop the server."
echo ""

# Open browser after a short delay
(sleep 1 && open "http://localhost:$PORT") &

# Start server
python3 -m http.server "$PORT"
