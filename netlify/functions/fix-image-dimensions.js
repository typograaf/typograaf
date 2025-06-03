// netlify/functions/fix-image-dimensions.js
// Calculate dimensions for images that are already in Supabase Storage

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
    
    const length = (uint8Array[offset + 2] << 8) | uint8Array[offset + 3];
    offset += 2 + length;
  }
  
  return null;
}

function getPNGDimensions(uint8Array) {
  const width = (uint8Array[16] << 24) | (uint8Array[17] << 16) | (uint8Array[18] << 8) | uint8Array[19];
  const height = (uint8Array[20] << 24) | (uint8Array[21] << 16) | (uint8Array[22] << 8) | uint8Array[23];
  
  return { width, height, aspectRatio: width / height };
}

function getWebPDimensions(uint8Array) {
  if (uint8Array[12] === 0x56 && uint8Array[13] === 0x50 && uint8Array[14] === 0x38) {
    const width = ((uint8Array[26] | (uint8Array[27] << 8)) & 0x3fff) + 1;
    const height = ((uint8Array[28] | (uint8Array[29] << 8)) & 0x3fff) + 1;
    
    return { width, height, aspectRatio: width / height };
  }
  
  return null;
}

exports.handler = async (event, context) => {
  console.log('=== FIX IMAGE DIMENSIONS START ===');
  
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
    
    if (!supabaseUrl || !supabaseKey) {
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
    
    // Get images that have storage URLs but no dimensions
    const { data: images, error } = await supabase
      .from('portfolio_images')
      .select('*')
      .not('storage_url', 'is', null)
      .or('width.is.null,height.is.null')
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
    
    console.log(`Found ${images.length} images that need dimension calculation`);
    
    if (images.length === 0) {
      // Check status
      const { data: allImages } = await supabase
        .from('portfolio_images')
        .select('storage_url, width, height')
        .not('storage_url', 'is', null);
      
      const { data: noDimensions } = await supabase
        .from('portfolio_images')
        .select('name')
        .not('storage_url', 'is', null)
        .or('width.is.null,height.is.null');
      
      const withDimensions = allImages?.filter(img => img.width && img.height).length || 0;
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          processed: 0,
          failed: 0,
          total: 0,
          totalInStorage: allImages?.length || 0,
          withDimensions: withDimensions,
          needingDimensions: noDimensions?.length || 0,
          message: noDimensions?.length > 0 ? 
            `Found ${allImages?.length || 0} images in storage. ${withDimensions} have dimensions, ${noDimensions.length} still need calculation.` :
            `🎉 All ${withDimensions} images in storage have calculated dimensions!`,
          timestamp: new Date().toISOString()
        })
      };
    }
    
    let processed = 0;
    let failed = 0;
    const results = [];
    
    for (const image of images) {
      if (Date.now() - startTime > maxProcessingTime) {
        console.log('Time limit reached, stopping processing');
        break;
      }
      
      try {
        console.log(`Processing dimensions for: ${image.name}`);
        
        if (!image.storage_url) {
          throw new Error('No storage URL found');
        }
        
        // Download image from Supabase Storage
        console.log(`Downloading from storage: ${image.storage_url}`);
        const imageResponse = await Promise.race([
          fetch(image.storage_url),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Download timeout')), 4000)
          )
        ]);
        
        if (!imageResponse.ok) {
          throw new Error(`Download failed: ${imageResponse.status}`);
        }
        
        const imageBuffer = await imageResponse.arrayBuffer();
        
        // Calculate dimensions
        console.log(`Calculating dimensions for: ${image.name}`);
        const dimensions = getImageDimensions(imageBuffer);
        
        if (!dimensions) {
          throw new Error('Could not parse image dimensions');
        }
        
        console.log(`✅ Dimensions: ${dimensions.width}x${dimensions.height} (ratio: ${dimensions.aspectRatio.toFixed(3)})`);
        
        // Update database with dimensions
        const { error: updateError } = await supabase
          .from('portfolio_images')
          .update({
            width: dimensions.width,
            height: dimensions.height,
            aspectratio: parseFloat(dimensions.aspectRatio.toFixed(6)),
            dimensions_calculated: new Date().toISOString()
          })
          .eq('id', image.id);
        
        if (updateError) {
          throw new Error(`Database update failed: ${updateError.message}`);
        }
        
        processed++;
        results.push({
          name: image.name,
          status: 'success',
          dimensions: `${dimensions.width}x${dimensions.height}`,
          aspectRatio: dimensions.aspectRatio.toFixed(3),
          oldAspectRatio: image.aspectratio ? image.aspectratio.toFixed(3) : 'none'
        });
        
        console.log(`✅ Updated dimensions for: ${image.name} (${dimensions.width}x${dimensions.height})`);
        
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
    const { data: allInStorage } = await supabase
      .from('portfolio_images')
      .select('id, width, height')
      .not('storage_url', 'is', null);
    
    const { data: stillNeedDimensions } = await supabase
      .from('portfolio_images')
      .select('id')
      .not('storage_url', 'is', null)
      .or('width.is.null,height.is.null');
    
    const totalInStorage = allInStorage?.length || 0;
    const withDimensions = allInStorage?.filter(img => img.width && img.height).length || 0;
    const remaining = stillNeedDimensions?.length || 0;
    
    console.log(`Dimension calculation complete: ${processed} processed, ${failed} failed. Total progress: ${withDimensions}/${totalInStorage} images have dimensions, ${remaining} remaining`);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        processed: processed,
        failed: failed,
        total: images.length,
        totalInStorage: totalInStorage,
        withDimensions: withDimensions,
        remaining: remaining,
        results: results,
        message: remaining > 0 ? 
          `Batch complete! ${processed} dimensions calculated this round. ${withDimensions}/${totalInStorage} images have dimensions, ${remaining} remaining. Run again to continue.` :
          `🎉 All ${withDimensions} images now have calculated dimensions!`,
        continueUrl: remaining > 0 ? '/.netlify/functions/fix-image-dimensions' : null,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('Dimension fix error:', error);
    
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