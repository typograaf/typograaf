        // Create filename
        const fileExtension = image.extension || 'jpg';
        const cleanName = image.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const cleanProject = (image.project || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const cleanTool = (image.tool || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const fileName = `${cleanProject}/${cleanTool}/${cleanName}.${fileExtension}`;
        
        console.log(`Uploading: ${fileName} (${imageUint8Array.length} bytes)`);
        
        // Upload to Supabase Storage
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
        
        const publicUrl = urlData.publicUrl;// netlify/functions/sync-to-supabase-storage.js
// Fixed version using server-side image dimension detection

const { createClient } = require('@supabase/supabase-js');

// Helper function to parse image dimensions from buffer
function getImageDimensions(buffer) {
  try {
    const uint8Array = new Uint8Array(buffer);
    
    // JPEG detection
    if (uint8Array[0] === 0xFF && uint8Array[1] === 0xD8) {
      return getJPEGDimensions(uint8Array);
    }
    
    // PNG detection
    if (uint8Array[0] === 0x89 && uint8Array[1] === 0x50 && uint8Array[2] === 0x4E && uint8Array[3] === 0x47) {
      return getPNGDimensions(uint8Array);
    }
    
    // WebP detection
    if (uint8Array[8] === 0x57 && uint8Array[9] === 0x45 && uint8Array[10] === 0x42 && uint8Array[11] === 0x50) {
      return getWebPDimensions(uint8Array);
    }
    
    return null;
  } catch (error) {
    console.error('Error parsing image dimensions:', error);
    return null;
  }
}

function getJPEGDimensions(uint8Array) {
  let offset = 2;
  
  while (offset < uint8Array.length) {
    // Find next marker
    if (uint8Array[offset] !== 0xFF) {
      offset++;
      continue;
    }
    
    const marker = uint8Array[offset + 1];
    
    // SOF markers (Start of Frame)
    if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) || 
        (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
      
      const height = (uint8Array[offset + 5] << 8) | uint8Array[offset + 6];
      const width = (uint8Array[offset + 7] << 8) | uint8Array[offset + 8];
      
      return { width, height, aspectRatio: width / height };
    }
    
    // Skip to next marker
    const length = (uint8Array[offset + 2] << 8) | uint8Array[offset + 3];
    offset += 2 + length;
  }
  
  return null;
}

function getPNGDimensions(uint8Array) {
  // PNG width is at bytes 16-19, height at bytes 20-23
  const width = (uint8Array[16] << 24) | (uint8Array[17] << 16) | (uint8Array[18] << 8) | uint8Array[19];
  const height = (uint8Array[20] << 24) | (uint8Array[21] << 16) | (uint8Array[22] << 8) | uint8Array[23];
  
  return { width, height, aspectRatio: width / height };
}

function getWebPDimensions(uint8Array) {
  // Simple WebP VP8 format
  if (uint8Array[12] === 0x56 && uint8Array[13] === 0x50 && uint8Array[14] === 0x38) {
    const width = ((uint8Array[26] | (uint8Array[27] << 8)) & 0x3fff) + 1;
    const height = ((uint8Array[28] | (uint8Array[29] << 8)) & 0x3fff) + 1;
    
    return { width, height, aspectRatio: width / height };
  }
  
  return null;
}

exports.handler = async (event, context) => {
  console.log('=== FIXED STORAGE SYNC WITH DIMENSIONS ===');
  
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
  const maxProcessingTime = 8000;
  
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
    
    // Get images that need migration OR dimension calculation
    const { data: images, error } = await supabase
      .from('portfolio_images')
      .select('*')
      .or('storage_url.is.null,storage_url.eq.,width.is.null,height.is.null')
      .not('path', 'is', null)
      .limit(3);
    
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
        .or('storage_url.is.null,storage_url.eq.,width.is.null,height.is.null')
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
      if (Date.now() - startTime > maxProcessingTime) {
        console.log('Time limit reached, stopping processing');
        break;
      }
      
      try {
        console.log(`Processing: ${image.name}`);
        
        // Get temporary URL from Dropbox
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
        
        // Skip download if we already have the image in storage and just need dimensions
        let imageBuffer, imageUint8Array, publicUrl, fileName, uploadData;
        let needsUpload = !image.storage_url;
        
        if (needsUpload) {
          // Download from Dropbox if we don't have it in storage yet
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
          
          imageBuffer = await imageResponse.arrayBuffer();
          imageUint8Array = new Uint8Array(imageBuffer);
          
          // Create filename
          const fileExtension = image.extension || 'jpg';
          const cleanName = image.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
          const cleanProject = (image.project || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
          const cleanTool = (image.tool || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
          fileName = `${cleanProject}/${cleanTool}/${cleanName}.${fileExtension}`;
          
          console.log(`Uploading: ${fileName} (${imageUint8Array.length} bytes)`);
          
          // Upload to Supabase Storage
          const uploadResult = await Promise.race([
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
          
          if (uploadResult.error) {
            throw new Error(`Upload failed: ${uploadResult.error.message}`);
          }
          
          uploadData = uploadResult.data;
          
          // Get public URL
          const { data: urlData } = supabase.storage
            .from('portfolio-images')
            .getPublicUrl(fileName);
          
          publicUrl = urlData.publicUrl;
          
        } else {
          // Image already in storage, download from Supabase Storage for dimension calculation
          console.log(`Downloading from storage for dimensions: ${image.name}`);
          const storageResponse = await Promise.race([
            fetch(image.storage_url),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Storage download timeout')), 4000)
            )
          ]);
          
          if (!storageResponse.ok) {
            throw new Error(`Storage download failed: ${storageResponse.status}`);
          }
          
          imageBuffer = await storageResponse.arrayBuffer();
          publicUrl = image.storage_url;
          fileName = image.storage_path;
        }
        
        // 🆕 Calculate dimensions using server-side parsing
        console.log(`Calculating dimensions for: ${image.name}`);
        const dimensions = getImageDimensions(imageBuffer);
        
        if (dimensions) {
          console.log(`✅ Dimensions: ${dimensions.width}x${dimensions.height} (ratio: ${dimensions.aspectRatio.toFixed(3)})`);
        } else {
          console.warn(`⚠️ Could not parse dimensions for ${image.name}`);
        }
        
        // Create filename
        const fileExtension = image.extension || 'jpg';
        const cleanName = image.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const cleanProject = (image.project || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const cleanTool = (image.tool || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const fileName = `${cleanProject}/${cleanTool}/${cleanName}.${fileExtension}`;
        
        console.log(`Uploading: ${fileName} (${imageUint8Array.length} bytes)`);
        
        // Upload to Supabase Storage
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
        
        // Prepare database update
        const updateData = {};
        
        // Add storage info if this was a new upload
        if (needsUpload) {
          updateData.storage_url = publicUrl;
          updateData.storage_path = fileName;
          updateData.migrated_to_storage = new Date().toISOString();
        }
        
        // Add dimensions if we calculated them
        if (dimensions) {
          updateData.width = dimensions.width;
          updateData.height = dimensions.height;
          updateData.aspectratio = parseFloat(dimensions.aspectRatio.toFixed(6));
          updateData.dimensions_calculated = new Date().toISOString();
        }
        
        // Only update if we have something to update
        if (Object.keys(updateData).length > 0) {
          const { error: updateError } = await supabase
            .from('portfolio_images')
            .update(updateData)
            .eq('id', image.id);
          
          if (updateError) {
            throw new Error(`Database update failed: ${updateError.message}`);
          }
        }
        
        uploaded++;
        results.push({
          name: image.name,
          status: 'success',
          url: publicUrl,
          dimensions: dimensions ? `${dimensions.width}x${dimensions.height}` : 'not calculated',
          aspectRatio: dimensions ? dimensions.aspectRatio.toFixed(3) : 'unknown'
        });
        
        console.log(`✅ ${needsUpload ? 'Migrated' : 'Updated dimensions for'}: ${image.name}${dimensions ? ` (${dimensions.width}x${dimensions.height})` : ''}`);
        
        // Small delay
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
      .or('storage_url.is.null,storage_url.eq.,width.is.null,height.is.null')
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