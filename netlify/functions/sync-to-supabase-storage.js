// netlify/functions/sync-to-supabase-storage.js
// Enhanced version that calculates real image dimensions during migration

const { createClient } = require('@supabase/supabase-js');

// Helper function to calculate image dimensions
function calculateImageDimensions(imageBuffer) {
  return new Promise((resolve, reject) => {
    try {
      // Create a blob from the buffer
      const blob = new Blob([imageBuffer]);
      const img = new Image();
      
      img.onload = () => {
        const dimensions = {
          width: img.width,
          height: img.height,
          aspectRatio: img.width / img.height
        };
        
        // Clean up
        URL.revokeObjectURL(img.src);
        resolve(dimensions);
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(img.src);
        reject(new Error('Failed to load image for dimension calculation'));
      };
      
      // Create object URL and load image
      img.src = URL.createObjectURL(blob);
      
    } catch (error) {
      reject(error);
    }
  });
}

exports.handler = async (event, context) => {
  console.log('=== ENHANCED STORAGE SYNC WITH DIMENSIONS ===');
  
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  const startTime = Date.now();
  const maxProcessingTime = 8000; // 8 seconds to stay under 10s limit
  
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN;
    
    if (!supabaseUrl || !supabaseKey || !dropboxToken) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Missing environment variables'
        })
      };
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get images that need migration - smaller batch
    const { data: images, error } = await supabase
      .from('portfolio_images')
      .select('*')
      .or('storage_url.is.null,storage_url.eq.')
      .not('path', 'is', null)
      .limit(3); // Only 3 at a time to avoid timeout
    
    if (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: error.message
        })
      };
    }
    
    console.log(`Found ${images.length} images to migrate`);
    
    if (images.length === 0) {
      // Check migration status
      const { data: allImages } = await supabase
        .from('portfolio_images')
        .select('storage_url, name, width, height')
        .not('storage_url', 'is', null);
      
      const { data: remainingImages } = await supabase
        .from('portfolio_images')
        .select('name')
        .or('storage_url.is.null,storage_url.eq.')
        .not('path', 'is', null);
      
      const withDimensions = allImages?.filter(img => img.width && img.height).length || 0;
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          uploaded: 0,
          failed: 0,
          total: 0,
          migrated: allImages?.length || 0,
          withDimensions: withDimensions,
          remaining: remainingImages?.length || 0,
          message: remainingImages?.length > 0 ? 
            `Migration in progress: ${allImages?.length || 0} done (${withDimensions} with dimensions), ${remainingImages.length} remaining` :
            `🎉 All images migrated! ${allImages?.length || 0} images in storage, ${withDimensions} with calculated dimensions.`,
          timestamp: new Date().toISOString()
        })
      };
    }
    
    let uploaded = 0;
    let failed = 0;
    const results = [];
    
    for (const image of images) {
      // Check if we're running out of time
      if (Date.now() - startTime > maxProcessingTime) {
        console.log('Time limit reached, stopping processing');
        break;
      }
      
      try {
        console.log(`Processing: ${image.name}`);
        
        // Get temporary URL with timeout
        const tempUrlResponse = await Promise.race([
          fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${dropboxToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ path: image.path })
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Dropbox API timeout')), 3000)
          )
        ]);
        
        if (!tempUrlResponse.ok) {
          const errorText = await tempUrlResponse.text();
          throw new Error(`Dropbox API error: ${tempUrlResponse.status} - ${errorText}`);
        }
        
        const tempUrlData = await tempUrlResponse.json();
        const dropboxUrl = tempUrlData.link;
        
        // Download with timeout
        console.log(`Downloading: ${image.name}`);
        const imageResponse = await Promise.race([
          fetch(dropboxUrl),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Download timeout')), 4000)
          )
        ]);
        
        if (!imageResponse.ok) {
          throw new Error(`Download failed: ${imageResponse.status}`);
        }
        
        const imageBuffer = await imageResponse.arrayBuffer();
        const imageUint8Array = new Uint8Array(imageBuffer);
        
        // 🆕 Calculate real image dimensions
        console.log(`Calculating dimensions for: ${image.name}`);
        let dimensions = null;
        try {
          dimensions = await Promise.race([
            calculateImageDimensions(imageBuffer),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Dimension calculation timeout')), 2000)
            )
          ]);
          console.log(`Dimensions: ${dimensions.width}x${dimensions.height} (ratio: ${dimensions.aspectRatio.toFixed(3)})`);
        } catch (dimError) {
          console.warn(`Could not calculate dimensions for ${image.name}: ${dimError.message}`);
          // Continue without dimensions - we'll use the old aspect ratio
        }
        
        // Create filename
        const fileExtension = image.extension || 'jpg';
        const cleanName = image.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const cleanProject = (image.project || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const cleanTool = (image.tool || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const fileName = `${cleanProject}/${cleanTool}/${cleanName}.${fileExtension}`;
        
        console.log(`Uploading: ${fileName} (${imageUint8Array.length} bytes)`);
        
        // Upload to Supabase Storage with timeout
        const { data: uploadData, error: uploadError } = await Promise.race([
          supabase.storage
            .from('portfolio-images')
            .upload(fileName, imageUint8Array, {
              contentType: `image/${fileExtension}`,
              upsert: true
            }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Upload timeout')), 4000)
          )
        ]);
        
        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }
        
        // Get public URL
        const { data: urlData } = supabase.storage
          .from('portfolio-images')
          .getPublicUrl(fileName);
        
        const publicUrl = urlData.publicUrl;
        
        // 🆕 Prepare database update with dimensions
        const updateData = {
          storage_url: publicUrl,
          storage_path: fileName,
          migrated_to_storage: new Date().toISOString()
        };
        
        // Add dimensions if we calculated them successfully
        if (dimensions) {
          updateData.width = dimensions.width;
          updateData.height = dimensions.height;
          updateData.aspectratio = dimensions.aspectRatio;
          updateData.dimensions_calculated = new Date().toISOString();
        }
        
        // Update database with storage info and dimensions
        const { error: updateError } = await supabase
          .from('portfolio_images')
          .update(updateData)
          .eq('id', image.id);
        
        if (updateError) {
          throw new Error(`Database update failed: ${updateError.message}`);
        }
        
        uploaded++;
        results.push({
          name: image.name,
          status: 'success',
          url: publicUrl,
          dimensions: dimensions ? `${dimensions.width}x${dimensions.height}` : 'not calculated',
          aspectRatio: dimensions ? dimensions.aspectRatio.toFixed(3) : 'unknown'
        });
        
        console.log(`✅ Migrated: ${image.name}${dimensions ? ` (${dimensions.width}x${dimensions.height})` : ''}`);
        
        // Small delay to avoid overwhelming the services
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`❌ Failed to process ${image.name}:`, error.message);
        failed++;
        results.push({
          name: image.name,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    // Get overall progress
    const { data: allMigrated } = await supabase
      .from('portfolio_images')
      .select('id, width, height')
      .not('storage_url', 'is', null);
    
    const { data: stillRemaining } = await supabase
      .from('portfolio_images')
      .select('id')
      .or('storage_url.is.null,storage_url.eq.')
      .not('path', 'is', null);
    
    const totalMigrated = allMigrated?.length || 0;
    const withDimensions = allMigrated?.filter(img => img.width && img.height).length || 0;
    const remaining = stillRemaining?.length || 0;
    
    console.log(`Batch complete: ${uploaded} uploaded, ${failed} failed. Total progress: ${totalMigrated} migrated (${withDimensions} with dimensions), ${remaining} remaining`);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        uploaded: uploaded,
        failed: failed,
        total: images.length,
        totalMigrated: totalMigrated,
        withDimensions: withDimensions,
        remaining: remaining,
        results: results,
        message: remaining > 0 ? 
          `Batch complete! ${uploaded} migrated this round. ${totalMigrated} total done (${withDimensions} with dimensions), ${remaining} remaining. Run again to continue.` :
          `🎉 Migration complete! All ${totalMigrated} images are now in Supabase Storage with ${withDimensions} having calculated dimensions.`,
        continueUrl: remaining > 0 ? '/.netlify/functions/sync-to-supabase-storage' : null,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('Sync error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};