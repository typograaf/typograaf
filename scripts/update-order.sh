#!/bin/bash

# Update project order from Finder's Date Added

PORTFOLIO_DIR="/Users/mdnd-martijn/Library/CloudStorage/Dropbox/AboutContact/Website/Portfolio"
PROJECT_FILE="/Users/mdnd-martijn/Typograaf/project-order.json"
LOG_FILE="/Users/mdnd-martijn/Typograaf/scripts/convert.log"

update_order() {
    echo "$(date): Updating project order" >> "$LOG_FILE"

    # Get folder names sorted by date added (newest first)
    local new_order=$(ls -ltU "$PORTFOLIO_DIR" | grep "^d" | awk -F' ' '{for(i=9;i<=NF;i++) printf "%s ", $i; print ""}' | sed 's/ $//' | jq -R -s 'split("\n") | map(select(length > 0))')

    # Validate: must have at least 5 projects, don't overwrite with empty/small array
    local count=$(echo "$new_order" | jq 'length')
    if [ "$count" -lt 5 ]; then
        echo "$(date): ERROR - Only found $count projects, keeping existing order" >> "$LOG_FILE"
        return 1
    fi

    echo "$new_order" > "$PROJECT_FILE"

    # Commit and deploy
    cd /Users/mdnd-martijn/Typograaf
    git add project-order.json
    if git diff --cached --quiet; then
        echo "$(date): No changes to project order" >> "$LOG_FILE"
    else
        git commit -m "Update project order"
        npx vercel --prod > /dev/null 2>&1
        echo "$(date): Deployed new project order" >> "$LOG_FILE"
    fi
}

# Run once at start
update_order

# Watch for new folders
fswatch -0 -r --event Created --event Removed "$PORTFOLIO_DIR" | while read -d "" event; do
    # Only trigger on directory changes
    if [ -d "$event" ] || [ ! -e "$event" ]; then
        sleep 10  # Wait for Dropbox sync
        update_order
    fi
done
