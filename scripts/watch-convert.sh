#!/bin/bash

# Auto-convert watcher for Portfolio folder
# Converts JPG/PNG to AVIF, GIF to animated WebP

PORTFOLIO_DIR="/Users/mdnd-martijn/Library/CloudStorage/Dropbox/AboutContact/Website/Portfolio"
LOG_FILE="/Users/mdnd-martijn/Typograaf/scripts/convert.log"
TOKEN_FILE="/Users/mdnd-martijn/Typograaf/scripts/.dropbox_token"

# Load Dropbox token
if [ -f "$TOKEN_FILE" ]; then
    source "$TOKEN_FILE"
fi

delete_file_via_api() {
    local file="$1"

    # Convert local path to Dropbox path
    # Local: /Users/mdnd-martijn/Library/CloudStorage/Dropbox/AboutContact/Website/Portfolio/...
    # Dropbox: /AboutContact/Website/Portfolio/...
    local dropbox_path="${file#/Users/mdnd-martijn/Library/CloudStorage/Dropbox}"

    if [ -z "$DROPBOX_TOKEN" ] || [ "$DROPBOX_TOKEN" = "your_token_here" ]; then
        echo "$(date): ERROR - No Dropbox token configured in $TOKEN_FILE" >> "$LOG_FILE"
        return 1
    fi

    echo "$(date): Deleting via API: $dropbox_path" >> "$LOG_FILE"

    # Use Dropbox API to delete file from cloud
    local response=$(curl -s -X POST https://api.dropboxapi.com/2/files/delete_v2 \
        --header "Authorization: Bearer $DROPBOX_TOKEN" \
        --header "Content-Type: application/json" \
        --data "{\"path\": \"$dropbox_path\"}")

    if echo "$response" | grep -q '"metadata"'; then
        echo "$(date): API delete successful" >> "$LOG_FILE"
        return 0
    else
        echo "$(date): API delete failed: $response" >> "$LOG_FILE"
        return 1
    fi
}

convert_file() {
    local file="$1"
    local dir=$(dirname "$file")
    local base=$(basename "$file" | sed 's/\.[^.]*$//')
    local ext="${file##*.}"
    ext=$(echo "$ext" | tr '[:upper:]' '[:lower:]')

    case "$ext" in
        jpg|jpeg|png)
            local avif_file="$dir/$base.avif"
            if [ ! -f "$avif_file" ]; then
                echo "$(date): Converting $file" >> "$LOG_FILE"
                avifenc -q 60 -s 6 "$file" "$avif_file" 2>> "$LOG_FILE"
                if [ $? -eq 0 ] && [ -f "$avif_file" ]; then
                    delete_file_via_api "$file"
                    echo "$(date): Done" >> "$LOG_FILE"
                fi
            fi
            ;;
        gif)
            local webp_file="$dir/$base.webp"
            if [ ! -f "$webp_file" ]; then
                echo "$(date): Converting $file" >> "$LOG_FILE"
                gif2webp -q 80 -m 6 "$file" -o "$webp_file" 2>> "$LOG_FILE"
                if [ $? -eq 0 ] && [ -f "$webp_file" ]; then
                    delete_file_via_api "$file"
                    echo "$(date): Done" >> "$LOG_FILE"
                fi
            fi
            ;;
    esac
}

echo "$(date): Watcher started" >> "$LOG_FILE"

fswatch -0 -r -e ".*" -i "\\.jpg$" -i "\\.jpeg$" -i "\\.png$" -i "\\.gif$" -i "\\.JPG$" -i "\\.JPEG$" -i "\\.PNG$" -i "\\.GIF$" "$PORTFOLIO_DIR" | while read -d "" file; do
    if [ -f "$file" ]; then
        sleep 5  # Wait for Dropbox to finish syncing the file
        convert_file "$file"
    fi
done
