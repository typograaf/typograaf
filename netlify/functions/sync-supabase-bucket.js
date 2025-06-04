// netlify/functions/sync-supabase-bucket.js
// Scan Supabase Storage bucket and sync to database with dimension calculation

const { createClient } = require('@supabase/supabase-js');

// Image dimension parsers (same as debug version)
function parseImageDimensions(uint8Array, fileName) {
  const format = detectImageFormat(uint8Array);
  
  if (format === 'avif' || format === 'webp' || format === 'unknown') {
    console.log(`Skipping ${format} format for ${fileName}`);
    return null;
  }
  
  switch (format) {
    case 'jpeg':
      return parseJPEG(uint8Array);
    case 'png':
      return parsePNG(uint8Array);
    case 'gif':
      return parseGIF(uint8Array);
    default:
      return null;
  }
}

function detectImageFormat(uint8Array) {
  if (uint8Array[0] === 0xFF && uint8Array[1] === 0xD8) return 'jpeg';
  if (uint8Array[0] === 0x89 && uint8Array[1] === 0x50 && uint8Array[2] === 0x4E && uint8Array[3] === 0x47) return 'png';
  if (uint8Array[0] === 0x47 && uint8Array[1] === 0x49 && uint8Array[2] === 0x46) return 'gif';
  if (uint8Array[4] === 0x66 && uint8Array[5] === 0x74 && uint8Array[6] === 0x79 && uint8Array[7] === 0x70) return 'avif';
  if (uint8Array[8] === 0x57 && uint8Array[9] === 0x45 && uint8Array[10] === 0x42 && uint8Array[11] === 0x50) return 'webp';
  return 'unknown';
}

function parseJPEG(uint8Array) {
  let offset = 2;
  
  while (offset < uint8Array.length - 10) {
    if (uint8Array[offset] !== 0xFF) {
      offset++;
      continue;
    }
    
    const marker = uint8Array[offset + 1];
    const isSOF = (marker >= 0xC0 && marker <= 0xC3) || 
                  (marker >= 0xC5 && marker <= 0xC7) || 
                  (marker >= 0xC9 && marker <= 0xCB) || 
                  (marker >= 0xCD && marker <= 0xCF);
    
    if (isSOF && offset + 9 < uint8Array.length) {
      const height = (uint8Array[offset + 5] << 8) | uint8Array[offset + 6];
      const width = (uint8Array[offset + 7] << 8) | uint8Array[offset + 8];
      
      if (width > 0 && height > 0 && width < 20000 && height < 20000) {
        return { width, height, aspectRatio: width / height };
      }
    }
    
    // Skip to next marker
    if (offset + 3 < uint8Array.length) {
      const length = (uint8Array[offset + 2] << 8) | uint8Array[offset + 3];
      offset += 2 + length;
    } else {
      break;
    }
  }
  
  return null;
}

function parsePNG(uint8Array) {
  const width = (uint8Array[16] << 24) | (uint8Array[17] << 16) | (uint8Array[18] << 8) | uint8Array[19];
  const height = (uint8Array[20] << 24) | (uint8Array[21] << 16) | (uint8Array[22] << 8) | uint8Array[23];
  
  if (width > 0 && height > 0 && width < 20000 && height < 20000) {
    return { width, height, aspectRatio: width / height };
  }
  
  return null;
}

function parseGIF(uint8Array) {
  const width = uint8Array[6] | (uint8Array[7] << 8);
  const height = uint8Array[8] | (uint8Array[9] << 8);
  
  if (width > 0 && height > 0 && width < 20000 && height < 20000) {
    return { width, height, aspectRatio: width / height };
  }
  
  return null;
}

// Extract metadata from file path
function extractMetadata(filePath) {
  const pathParts = filePath.split('/');
  const fileName = pathParts[pathParts.length - 1];
  const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
  
  // Try to extract project and tool from path
  let project = 'unknown';
  let tool = 'unknown';
  
  if (pathParts.length >= 3) {
    project = pathParts[0] || 'unknown';
    tool = pathParts[1] || 'unknown';
  } else if (pathParts.length === 2) {
    project = pathParts[0] || 'unknown';
  }
  
  // Clean up names
  project = project.replace(/[^a-zA-Z0-9\s-]/g, ' ').trim() || 'unknown';
  tool = tool.replace(/[^a-zA-Z0-9\s-]/g, ' ').trim() || 'unknown';
  
  // Get file extension
  const extension = fileName.split('.').pop()?.toLowerCase() || 'jpg';
  
  return {
    name: fileNameWithoutExt,
    project: project,
    tool: tool,
    extension: extension,
    type: 'image', // Default type
    time: '2024-Q1' // Default time
  };
}

exports.handler = async (event, context) => {
  console.log('=== SUPABASE BUCKET SYNC START ===');
  
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
  const maxProcessingTime = 25000; // 25 seconds
  
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
    
    console.log('Scanning Supabase Storage bucket...');
    
    // List all files in the portfolio-images bucket
    const { data: files, error: listError } = await supabase.storage
      .from('portfolio-images')
      .list('', {
        limit: 1000,
        sortBy: { column: 'name', order: 'asc' }
      });
    
    if (listError) {
      console.error('Storage list error:', listError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: `Failed to list storage files: ${listError.message}`
        })
      };
    }
    
    console.log(`Found ${files.length} files in storage`);
    
    // Get files recursively from all folders
    let allFiles = [];
    
    async function scanFolder(path = '') {
      try {
        console.log(`Scanning folder: ${path || 'root'}`);
        
        const { data: items, error } = await supabase.storage
          .from('portfolio-images')
          .list(path, { limit: 1000 });
        
        if (error) {
          console.error(`Error scanning folder ${path}:`, error);
          return;
        }
        
        console.log(`Found ${items?.length || 0} items in ${path || 'root'}`);
        
        for (const item of items || []) {
          const fullPath = path ? `${path}/${item.name}` : item.name;
          
          if (item.metadata && item.metadata.size > 0) {
            // It's a file with content
            allFiles.push({
              ...item,
              fullPath: fullPath
            });
            console.log(`Added file: ${fullPath} (${item.metadata.size} bytes)`);
          } else if (!item.metadata || item.metadata.size === undefined) {
            // It's likely a folder, scan recursively
            console.log(`Scanning subfolder: ${fullPath}`);
            await scanFolder(fullPath);
          }
        }
      } catch (error) {
        console.error(`Exception scanning folder ${path}:`, error);
      }
    }
    
    await scanFolder();
    
    console.log(`Found ${allFiles.length} total files (including subfolders)`);
    
    // Filter to image files only
    const imageFiles = allFiles.filter(file => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(ext);
      console.log(`File: ${file.name}, ext: ${ext}, isImage: ${isImage}`);
      return isImage;
    });
    
    console.log(`Found ${imageFiles.length} image files out of ${allFiles.length} total files`);
    
    if (imageFiles.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'No image files found in storage bucket',
          details: {
            totalFiles: allFiles.length,
            imageFiles: 0,
            scannedFolders: 'multiple'
          },
          allFiles: allFiles.map(f => ({ name: f.name, path: f.fullPath, size: f.metadata?.size }))
        })
      };
    }
    
    // Get existing database entries
    const { data: existingImages, error: dbError } = await supabase
      .from('portfolio_images')
      .select('*');
    
    if (dbError) {
      console.error('Database query error:', dbError);
    }
    
    const existingByStoragePath = {};
    (existingImages || []).forEach(img => {
      if (img.storage_path) {
        existingByStoragePath[img.storage_path] = img;
      }
    });
    
    let processed = 0;
    let updated = 0;
    let created = 0;
    let failed = 0;
    const results = [];
    
    // Process files in batches
    for (const file of imageFiles.slice(0, 10)) { // Limit to 10 files to avoid timeout
      if (Date.now() - startTime > maxProcessingTime) {
        console.log('Time limit reached, stopping processing');
        break;
      }
      
      try {
        console.log(`Processing: ${file.fullPath}`);
        
        // Get public URL
        const { data: urlData } = supabase.storage
          .from('portfolio-images')
          .getPublicUrl(file.fullPath);
        
        const publicUrl = urlData.publicUrl;
        
        // Extract metadata from path
        const metadata = extractMetadata(file.fullPath);
        
        // Check if this file already exists in database
        const existingImage = existingByStoragePath[file.fullPath];
        
        let dimensions = null;
        
        // Try to calculate dimensions if not already done
        if (!existingImage || !existingImage.width || !existingImage.height) {
          try {
            console.log(`Downloading ${file.fullPath} for dimension calculation...`);
            
            const imageResponse = await Promise.race([
              fetch(publicUrl),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Download timeout')), 5000)
              )
            ]);
            
            if (imageResponse.ok) {
              const imageBuffer = await imageResponse.arrayBuffer();
              const uint8Array = new Uint8Array(imageBuffer);
              
              console.log(`Downloaded ${uint8Array.length} bytes for ${file.name}`);
              
              dimensions = parseImageDimensions(uint8Array, file.name);
              
              if (dimensions) {
                console.log(`✅ Dimensions: ${dimensions.width}x${dimensions.height}`);
              } else {
                console.log(`⚠️ Could not parse dimensions for ${file.name} (format not supported)`);
              }
            } else {
              console.log(`⚠️ Download failed for ${file.name}: ${imageResponse.status}`);
            }
          } catch (dimError) {
            console.warn(`Could not calculate dimensions for ${file.name}: ${dimError.message}`);
          }
        } else {
          console.log(`Skipping dimension calculation for ${file.name} (already has dimensions)`);
        }
        
        const updateData = {
          name: metadata.name,
          project: metadata.project,
          tool: metadata.tool,
          type: metadata.type,
          time: metadata.time,
          extension: metadata.extension,
          storage_url: publicUrl,
          storage_path: file.fullPath,
          migrated_to_storage: new Date().toISOString(),
          modified: new Date().toISOString()
        };
        
        // Add dimensions if calculated
        if (dimensions) {
          updateData.width = dimensions.width;
          updateData.height = dimensions.height;
          updateData.aspectratio = parseFloat(dimensions.aspectRatio.toFixed(6));
          updateData.dimensions_calculated = new Date().toISOString();
        }
        
        if (existingImage) {
          // Update existing image
          const { error: updateError } = await supabase
            .from('portfolio_images')
            .update(updateData)
            .eq('id', existingImage.id);
          
          if (updateError) {
            throw new Error(`Update failed: ${updateError.message}`);
          }
          
          updated++;
          console.log(`✅ Updated: ${file.fullPath}`);
        } else {
          // Create new image entry
          const { error: insertError } = await supabase
            .from('portfolio_images')
            .insert(updateData);
          
          if (insertError) {
            throw new Error(`Insert failed: ${insertError.message}`);
          }
          
          created++;
          console.log(`✅ Created: ${file.fullPath}`);
        }
        
        processed++;
        results.push({
          path: file.fullPath,
          status: 'success',
          action: existingImage ? 'updated' : 'created',
          dimensions: dimensions ? `${dimensions.width}x${dimensions.height}` : 'not calculated',
          metadata: metadata
        });
        
      } catch (error) {
        console.error(`❌ Failed to process ${file.fullPath}:`, error.message);
        failed++;
        results.push({
          path: file.fullPath,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    // Get final stats
    const { data: finalImages } = await supabase
      .from('portfolio_images')
      .select('storage_url, width, height')
      .not('storage_url', 'is', null);
    
    const totalInStorage = finalImages?.length || 0;
    const withDimensions = finalImages?.filter(img => img.width && img.height).length || 0;
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        processed: processed,
        updated: updated,
        created: created,
        failed: failed,
        totalInStorage: totalInStorage,
        withDimensions: withDimensions,
        results: results,
        message: processed > 0 ? 
          `Processed ${processed} files: ${created} created, ${updated} updated, ${failed} failed. ${totalInStorage} images in storage, ${withDimensions} with dimensions.` :
          `Scan complete: ${totalInStorage} images already in database`,
        moreFiles: imageFiles.length > 10 ? imageFiles.length - 10 : 0,
        continueUrl: imageFiles.length > 10 ? '/.netlify/functions/sync-supabase-bucket' : null,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('Bucket sync error:', error);
    
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