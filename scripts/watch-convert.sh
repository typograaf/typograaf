#!/bin/bash

# Auto-convert watcher for Portfolio folder
# Converts JPG/PNG to AVIF, GIF to animated WebP

PORTFOLIO_DIR="/Users/mdnd-martijn/Library/CloudStorage/Dropbox/AboutContact/Website/Portfolio"
LOG_FILE="/Users/mdnd-martijn/Typograaf/scripts/convert.log"

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
                echo "$(date): Converting $file -> $avif_file" >> "$LOG_FILE"
                avifenc -q 60 -s 6 "$file" "$avif_file" 2>> "$LOG_FILE"
                if [ $? -eq 0 ] && [ -f "$avif_file" ]; then
                    rm "$file"
                    echo "$(date): Done, removed original" >> "$LOG_FILE"
                fi
            fi
            ;;
        gif)
            local webp_file="$dir/$base.webp"
            if [ ! -f "$webp_file" ]; then
                echo "$(date): Converting $file -> $webp_file" >> "$LOG_FILE"
                gif2webp -q 80 -m 6 "$file" -o "$webp_file" 2>> "$LOG_FILE"
                if [ $? -eq 0 ] && [ -f "$webp_file" ]; then
                    rm "$file"
                    echo "$(date): Done, removed original" >> "$LOG_FILE"
                fi
            fi
            ;;
    esac
}

echo "$(date): Watcher started for $PORTFOLIO_DIR" >> "$LOG_FILE"

# Use fswatch to monitor folder
fswatch -0 -r -e ".*" -i "\\.jpg$" -i "\\.jpeg$" -i "\\.png$" -i "\\.gif$" -i "\\.JPG$" -i "\\.JPEG$" -i "\\.PNG$" -i "\\.GIF$" "$PORTFOLIO_DIR" | while read -d "" file; do
    if [ -f "$file" ]; then
        sleep 2  # Wait for file to finish writing
        convert_file "$file"
    fi
done
