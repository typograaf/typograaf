// netlify/functions/debug-dimensions-parser.js
// Debug version to find and fix the dimension parsing issues

const { createClient } = require('@supabase/supabase-js');

function debugImageFormat(uint8Array, fileName) {
  const first16Bytes = Array.from(uint8Array.slice(0, 16))
    .map(b => '0x' + b.toString(16).padStart(2, '0'))
    .join(' ');
  
  console.log(`\n=== DEBUGGING: ${fileName} ===`);
  console.log(`File size: ${uint8Array.length} bytes`);
  console.log(`First 16 bytes: ${first16Bytes}`);
  
  // Check format signatures
  if (uint8Array[0] === 0xFF && uint8Array[1] === 0xD8) {
    console.log('✅ Format detected: JPEG');
    return 'jpeg';
  } else if (uint8Array[0] === 0x89 && uint8Array[1] === 0x50 && uint8Array[2] === 0x4E && uint8Array[3] === 0x47) {
    console.log('✅ Format detected: PNG');
    return 'png';
  } else if (uint8Array[0] === 0x47 && uint8Array[1] === 0x49 && uint8Array[2] === 0x46) {
    console.log('✅ Format detected: GIF');
    return 'gif';
  } else if (uint8Array[4] === 0x66 && uint8Array[5] === 0x74 && uint8Array[6] === 0x79 && uint8Array[7] === 0x70) {
    console.log('⚠️ Format detected: AVIF (skipping)');
    return 'avif';
  } else if (uint8Array[8] === 0x57 && uint8Array[9] === 0x45 && uint8Array[10] === 0x42 && uint8Array[11] === 0x50) {
    console.log('⚠️ Format detected: WebP (skipping for now)');
    return 'webp';
  } else {
    console.log('❌ Unknown format');
    return 'unknown';
  }
}

function debugParsePNG(uint8Array) {
  console.log('\n--- PNG Parsing Debug ---');
  
  // PNG dimensions are at fixed positions
  const widthBytes = uint8Array.slice(16, 20);
  const heightBytes = uint8Array.slice(20, 24);
  
  console.log(`Width bytes (16-19): ${Array.from(widthBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);
  console.log(`Height bytes (20-23): ${Array.from(heightBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);
  
  const width = (uint8Array[16] << 24) | (uint8Array[17] << 16) | (uint8Array[18] << 8) | uint8Array[19];
  const height = (uint8Array[20] << 24) | (uint8Array[21] << 16) | (uint8Array[22] << 8) | uint8Array[23];
  
  console.log(`Calculated width: ${width}`);
  console.log(`Calculated height: ${height}`);
  
  if (width > 0 && height > 0 && width < 20000 && height < 20000) {
    console.log('✅ PNG dimensions look valid');
    return { width, height, aspectRatio: width / height };
  } else {
    console.log('❌ PNG dimensions look invalid');
    return null;
  }
}

function debugParseJPEG(uint8Array) {
  console.log('\n--- JPEG Parsing Debug ---');
  
  let offset = 2; // Skip initial FF D8
  let attempts = 0;
  
  while (offset < uint8Array.length - 10 && attempts < 20) {
    attempts++;
    
    // Find next FF marker
    if (uint8Array[offset] !== 0xFF) {
      offset++;
      continue;
    }
    
    const marker = uint8Array[offset + 1];
    const markerHex = '0x' + marker.toString(16).padStart(2, '0');
    
    console.log(`Offset ${offset}: Found marker FF ${markerHex}`);
    
    // Check if this is a SOF (Start of Frame) marker
    const isSOF = (marker >= 0xC0 && marker <= 0xC3) || 
                  (marker >= 0xC5 && marker <= 0xC7) || 
                  (marker >= 0xC9 && marker <= 0xCB) || 
                  (marker >= 0xCD && marker <= 0xCF);
    
    if (isSOF) {
      console.log(`✅ Found SOF marker at offset ${offset}`);
      
      if (offset + 9 < uint8Array.length) {
        const segmentLength = (uint8Array[offset + 2] << 8) | uint8Array[offset + 3];
        const precision = uint8Array[offset + 4];
        const height = (uint8Array[offset + 5] << 8) | uint8Array[offset + 6];
        const width = (uint8Array[offset + 7] << 8) | uint8Array[offset + 8];
        
        console.log(`Segment length: ${segmentLength}`);
        console.log(`Precision: ${precision}`);
        console.log(`Height bytes (${offset + 5}-${offset + 6}): 0x${uint8Array[offset + 5].toString(16)} 0x${uint8Array[offset + 6].toString(16)}`);
        console.log(`Width bytes (${offset + 7}-${offset + 8}): 0x${uint8Array[offset + 7].toString(16)} 0x${uint8Array[offset + 8].toString(16)}`);
        console.log(`Calculated width: ${width}`);
        console.log(`Calculated height: ${height}`);
        
        if (width > 0 && height > 0 && width < 20000 && height < 20000) {
          console.log('✅ JPEG dimensions look valid');
          return { width, height, aspectRatio: width / height };
        } else {
          console.log('❌ JPEG dimensions look invalid, continuing search...');
        }
      }
    }
    
    // Skip to next marker
    if (offset + 3 < uint8Array.length) {
      const length = (uint8Array[offset + 2] << 8) | uint8Array[offset + 3];
      console.log(`Skipping ${length} bytes to next marker`);
      offset += 2 + length;
    } else {
      break;
    }
  }
  
  console.log('❌ No valid JPEG SOF marker found');
  return null;
}

function debugParseGIF(uint8Array) {
  console.log('\n--- GIF Parsing Debug ---');
  
  // GIF dimensions are at bytes 6-9
  const widthBytes = uint8Array.slice(6, 8);
  const heightBytes = uint8Array.slice(8, 10);
  
  console.log(`Width bytes (6-7): ${Array.from(widthBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);
  console.log(`Height bytes (8-9): ${Array.from(heightBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);
  
  // GIF uses little-endian byte order
  const width = uint8Array[6] | (uint8Array[7] << 8);
  const height = uint8Array[8] | (uint8Array[9] << 8);
  
  console.log(`Calculated width: ${width}`);
  console.log(`Calculated height: ${height}`);
  
  if (width > 0 && height > 0 && width < 20000 && height < 20000) {
    console.log('✅ GIF dimensions look valid');
    return { width, height, aspectRatio: width / height };
  } else {
    console.log('❌ GIF dimensions look invalid');
    return null;
  }
}

function debugParseImage(uint8Array, fileName) {
  const format = debugImageFormat(uint8Array, fileName);
  
  // Skip formats we don't want to handle
  if (format === 'avif' || format === 'webp' || format === 'unknown') {
    console.log(`Skipping ${format} format`);
    return null;
  }
  
  let dimensions = null;
  
  switch (format) {
    case 'jpeg':
      dimensions = debugParseJPEG(uint8Array);
      break;
    case 'png':
      dimensions = debugParsePNG(uint8Array);
      break;
    case 'gif':
      dimensions = debugParseGIF(uint8Array);
      break;
  }
  
  if (dimensions) {
    console.log(`\n🎉 SUCCESS: ${fileName} = ${dimensions.width}x${dimensions.height} (ratio: ${dimensions.aspectRatio.toFixed(3)})`);
  } else {
    console.log(`\n❌ FAILED: Could not parse dimensions for ${fileName}`);
  }
  
  return dimensions;
}

exports.handler = async (event, context) => {
  console.log('=== DEBUG DIMENSIONS PARSER START ===');
  
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
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
    
    // Get a few images that need dimensions - focus on non-AVIF
    const { data: images, error } = await supabase
      .from('portfolio_images')
      .select('*')
      .not('storage_url', 'is', null)
      .or('width.is.null,height.is.null')
      .limit(3); // Just 3 for detailed debugging
    
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
    
    console.log(`Found ${images.length} images to debug`);
    
    if (images.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'No images need dimension calculation',
          debugInfo: 'All images already have dimensions'
        })
      };
    }
    
    const results = [];
    
    for (const image of images) {
      try {
        console.log(`\n📥 Downloading: ${image.name}`);
        console.log(`Storage URL: ${image.storage_url}`);
        
        // Download image
        const imageResponse = await fetch(image.storage_url);
        
        if (!imageResponse.ok) {
          throw new Error(`Download failed: ${imageResponse.status}`);
        }
        
        const contentType = imageResponse.headers.get('content-type') || '';
        const contentLength = imageResponse.headers.get('content-length') || '0';
        
        console.log(`Content-Type: ${contentType}`);
        console.log(`Content-Length: ${contentLength} bytes`);
        
        const imageBuffer = await imageResponse.arrayBuffer();
        const uint8Array = new Uint8Array(imageBuffer);
        
        // Debug parse the image
        const dimensions = debugParseImage(uint8Array, image.name);
        
        if (dimensions) {
          // Update database
          console.log(`\n💾 Updating database for ${image.name}...`);
          
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
            console.error('Database update error:', updateError);
            throw new Error(`Database update failed: ${updateError.message}`);
          }
          
          console.log(`✅ Database updated successfully`);
          
          results.push({
            name: image.name,
            status: 'success',
            contentType: contentType,
            dimensions: `${dimensions.width}x${dimensions.height}`,
            aspectRatio: dimensions.aspectRatio.toFixed(3)
          });
        } else {
          results.push({
            name: image.name,
            status: 'skipped',
            contentType: contentType,
            reason: 'Unsupported format or parsing failed'
          });
        }
        
      } catch (error) {
        console.error(`❌ Error processing ${image.name}:`, error.message);
        results.push({
          name: image.name,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    const successCount = results.filter(r => r.status === 'success').length;
    const skippedCount = results.filter(r => r.status === 'skipped').length;
    const failedCount = results.filter(r => r.status === 'failed').length;
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        processed: successCount,
        skipped: skippedCount,
        failed: failedCount,
        total: images.length,
        results: results,
        message: `Debug complete: ${successCount} successful, ${skippedCount} skipped, ${failedCount} failed`,
        note: 'Check server logs for detailed parsing information',
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('Debug parser error:', error);
    
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