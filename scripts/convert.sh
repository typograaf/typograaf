#!/bin/bash

# Image converter script
# Converts JPG/PNG to AVIF, GIF to animated WebP
# Requires: ffmpeg (brew install ffmpeg)

PORTFOLIO_DIR="/Users/mdnd-martijn/Library/CloudStorage/Dropbox/AboutContact/Website/Portfolio"

echo "Converting images in $PORTFOLIO_DIR..."

# Convert JPG/PNG to AVIF
find "$PORTFOLIO_DIR" -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" \) | while read file; do
    dir=$(dirname "$file")
    base=$(basename "$file" | sed 's/\.[^.]*$//')
    avif_file="$dir/$base.avif"

    if [ ! -f "$avif_file" ]; then
        echo "Converting: $file -> $avif_file"
        ffmpeg -i "$file" -c:v libaom-av1 -crf 30 -b:v 0 -still-picture 1 "$avif_file" -y -loglevel error
        if [ $? -eq 0 ]; then
            echo "  Done. Removing original..."
            rm "$file"
        fi
    fi
done

# Convert GIF to animated WebP (smaller, Safari-friendly)
find "$PORTFOLIO_DIR" -type f -iname "*.gif" | while read file; do
    dir=$(dirname "$file")
    base=$(basename "$file" .gif)
    base=$(basename "$base" .GIF)
    webp_file="$dir/$base.webp"

    if [ ! -f "$webp_file" ]; then
        echo "Converting GIF: $file -> $webp_file"
        ffmpeg -i "$file" -vcodec libwebp -lossless 0 -compression_level 6 -q:v 50 -loop 0 -an "$webp_file" -y -loglevel error
        if [ $? -eq 0 ]; then
            echo "  Done. Removing original GIF..."
            rm "$file"
        fi
    fi
done

echo "Conversion complete!"
