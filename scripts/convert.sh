#!/bin/bash

# Image converter script
# Converts JPG/PNG to AVIF, GIF to animated WebP
# Requires: libavif, webp (brew install libavif webp)

PORTFOLIO_DIR="/Users/mdnd-martijn/Library/CloudStorage/Dropbox/AboutContact/Website/Portfolio"

echo "Converting images in $PORTFOLIO_DIR..."

# Convert JPG/PNG to AVIF using avifenc
find "$PORTFOLIO_DIR" -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" \) | while read file; do
    dir=$(dirname "$file")
    base=$(basename "$file" | sed 's/\.[^.]*$//')
    avif_file="$dir/$base.avif"

    if [ ! -f "$avif_file" ]; then
        echo "Converting: $file -> $avif_file"
        avifenc -q 60 -s 6 "$file" "$avif_file" 2>/dev/null
        if [ $? -eq 0 ] && [ -f "$avif_file" ]; then
            echo "  Done. Removing original..."
            rm "$file"
        else
            echo "  Failed to convert"
        fi
    fi
done

# Convert GIF to animated WebP using gif2webp
find "$PORTFOLIO_DIR" -type f -iname "*.gif" | while read file; do
    dir=$(dirname "$file")
    base=$(basename "$file" .gif)
    base=$(basename "$base" .GIF)
    webp_file="$dir/$base.webp"

    if [ ! -f "$webp_file" ]; then
        echo "Converting GIF: $file -> $webp_file"
        gif2webp -q 80 -m 6 "$file" -o "$webp_file" 2>/dev/null
        if [ $? -eq 0 ] && [ -f "$webp_file" ]; then
            echo "  Done. Removing original GIF..."
            rm "$file"
        else
            echo "  Failed to convert"
        fi
    fi
done

echo "Conversion complete!"
