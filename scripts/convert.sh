#!/bin/bash

# Image converter script
# Converts JPG/PNG to AVIF, GIF to animated WebP
# Requires: libavif, webp (brew install libavif webp)

PORTFOLIO_DIR="/Users/mdnd-martijn/Library/CloudStorage/Dropbox/AboutContact/Website/Portfolio"
ENV_FILE="/Users/mdnd-martijn/Typograaf/.env.local"

# Load Dropbox credentials from .env.local
if [ -f "$ENV_FILE" ]; then
    export $(grep -E "^DROPBOX_(APP_KEY|APP_SECRET|REFRESH_TOKEN)=" "$ENV_FILE" | xargs)
fi

# Get fresh access token using refresh token
get_access_token() {
    if [ -z "$DROPBOX_REFRESH_TOKEN" ] || [ -z "$DROPBOX_APP_KEY" ] || [ -z "$DROPBOX_APP_SECRET" ]; then
        echo ""
        return 1
    fi

    local response=$(curl -s -X POST https://api.dropboxapi.com/oauth2/token \
        -d grant_type=refresh_token \
        -d "refresh_token=$DROPBOX_REFRESH_TOKEN" \
        -d "client_id=$DROPBOX_APP_KEY" \
        -d "client_secret=$DROPBOX_APP_SECRET")

    echo "$response" | sed -n 's/.*"access_token"[: ]*"\([^"]*\)".*/\1/p'
}

delete_file_via_api() {
    local file="$1"

    # Convert local path to Dropbox path
    local dropbox_path="${file#/Users/mdnd-martijn/Library/CloudStorage/Dropbox}"

    # Get fresh access token
    local token=$(get_access_token)
    if [ -z "$token" ]; then
        echo "  ERROR - Could not get Dropbox access token"
        echo "  Falling back to local rm..."
        rm "$file" 2>/dev/null
        return 1
    fi

    echo "  Deleting via Dropbox API: $dropbox_path"

    local response=$(curl -s -X POST https://api.dropboxapi.com/2/files/delete_v2 \
        --header "Authorization: Bearer $token" \
        --header "Content-Type: application/json" \
        --data "{\"path\": \"$dropbox_path\"}")

    if echo "$response" | grep -q '"metadata"'; then
        echo "  Deleted successfully"
        return 0
    else
        echo "  API delete failed: $response"
        echo "  Falling back to local rm..."
        rm "$file" 2>/dev/null
        return 1
    fi
}

echo "Converting images in $PORTFOLIO_DIR..."

# Convert JPG/PNG to AVIF using avifenc
find "$PORTFOLIO_DIR" -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" \) | while read file; do
    dir=$(dirname "$file")
    base=$(basename "$file" | sed 's/\.[^.]*$//')
    avif_file="$dir/$base.avif"

    if [ -f "$avif_file" ]; then
        # Converted file exists, delete original
        echo "Cleanup: Removing original (avif exists): $file"
        delete_file_via_api "$file"
    else
        echo "Converting: $file -> $avif_file"
        avifenc -q 60 -s 6 "$file" "$avif_file" 2>/dev/null
        if [ $? -eq 0 ] && [ -f "$avif_file" ]; then
            echo "  Done. Removing original..."
            delete_file_via_api "$file"
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

    if [ -f "$webp_file" ]; then
        # Converted file exists, delete original
        echo "Cleanup: Removing original GIF (webp exists): $file"
        delete_file_via_api "$file"
    else
        echo "Converting GIF: $file -> $webp_file"
        gif2webp -q 80 -m 6 "$file" -o "$webp_file" 2>/dev/null
        if [ $? -eq 0 ] && [ -f "$webp_file" ]; then
            echo "  Done. Removing original GIF..."
            delete_file_via_api "$file"
        else
            echo "  Failed to convert"
        fi
    fi
done

echo "Conversion complete!"
