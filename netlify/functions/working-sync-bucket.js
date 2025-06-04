// netlify/functions/working-sync-bucket.js
// Working sync function based on the deep scan results

const { createClient } = require('@supabase/supabase-js');

// Image dimension parsers (for JPEG, PNG, GIF only)
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

exports.handler = async (event, context) => {
  console.log('=== WORKING SYNC BUCKET START ===');
  
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
  const maxProcessingTime = 20000; // 20 seconds
  
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing environment variables');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('Scanning storage for images...');
    
    // Get projects (root level folders)
    const { data: projects, error: projectsError } = await supabase.storage
      .from('portfolio-images')
      .list('', { limit: 100 });
    
    if (projectsError) {
      throw new Error(`Projects list failed: ${projectsError.message}`);
    }
    
    console.log(`Found ${projects.length} projects`);
    
    // Scan projects for images (project/tool/files structure)
    let allImageFiles = [];
    let projectsScanned = 0;
    
    for (const project of projects.slice(0, 5)) { // Process 5 projects at a time
      if (Date.now() - startTime > maxProcessingTime) {
        console.log('Time limit reached, stopping scan');
        break;
      }
      
      if (project.metadata) continue; // Skip files in root
      
      try {
        console.log(`Scanning project: ${project.name}`);
        
        const { data: tools, error: toolsError } = await supabase.storage
          .from('portfolio-images')
          .list(project.name, { limit: 100 });
        
        if (toolsError) {
          console.error(`Tools list failed for ${project.name}:`, toolsError);
          continue;
        }
        
        for (const tool of tools) {
          if (tool.metadata) {
            // File directly in project folder
            const ext = tool.name.split('.').pop()?.toLowerCase();
            if (['jpg', 'jpeg', 'png', 'gif', 'avif', 'webp'].includes(ext)) {
              allImageFiles.push({
                name: tool.name.replace(/\.[^/.]+$/, ''), // Remove extension
                fullPath: `${project.name}/${tool.name}`,
                project: project.name,
                tool: 'root',
                extension: ext,
                size: tool.metadata.size
              });
            }
          } else {
            // Tool folder
            try {
              const { data: files, error: filesError } = await supabase.storage
                .from('portfolio-images')
                .list(`${project.name}/${tool.name}`, { limit: 100 });
              
              if (filesError) continue;
              
              for (const file of files) {
                if (file.metadata && file.metadata.size > 0) {
                  const ext = file.name.split('.').pop()?.toLowerCase();
                  if (['jpg', 'jpeg', 'png', 'gif', 'avif', 'webp'].includes(ext)) {
                    allImageFiles.push({
                      name: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
                      fullPath: `${project.name}/${tool.name}/${file.name}`,
                      project: project.name,
                      tool: tool.name,
                      extension: ext,
                      size: file.metadata.size
                    });
                  }
                }
              }
            } catch (toolError) {
              console.error(`Error scanning tool ${project.name}/${tool.name}:`, toolError);
            }
          }
        }
        
        projectsScanned++;
        
      } catch (projectError) {
        console.error(`Error scanning project ${project.name}:`, projectError);
      }
    }
    
    console.log(`Found ${allImageFiles.length} images in ${projectsScanned} projects`);
    
    if (allImageFiles.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'No images found to process',
          projectsScanned: projectsScanned,
          imagesFound: 0
        })
      };
    }
    
    // Get existing database entries
    const { data: existingImages } = await supabase
      .from('portfolio_images')
      .select('*');
    
    const existingByPath = {};
    (existingImages || []).forEach(img => {
      if (img.storage_path) {
        existingByPath[img.storage_path] = img;
      }
    });
    
    let processed = 0;
    let updated = 0;
    let created = 0;
    let failed = 0;
    const results = [];
    
    // Process images (3 at a time to avoid timeout)
    for (const imageFile of allImageFiles.slice(0, 3)) {
      if (Date.now() - startTime > maxProcessingTime) {
        console.log('Time limit reached, stopping processing');
        break;
      }
      
      try {
        console.log(`Processing: ${imageFile.fullPath}`);
        
        // Get public URL
        const { data: urlData } = supabase.storage
          .from('portfolio-images')
          .getPublicUrl(imageFile.fullPath);
        
        const publicUrl = urlData.publicUrl;
        
        // Check if exists in database
        const existingImage = existingByPath[imageFile.fullPath];
        
        // Calculate dimensions for JPEG/PNG/GIF only
        let dimensions = null;
        if (['jpg', 'jpeg', 'png', 'gif'].includes(imageFile.extension)) {
          if (!existingImage || !existingImage.width || !existingImage.height) {
            try {
              console.log(`Downloading for dimensions: ${imageFile.fullPath}`);
              
              const response = await Promise.race([
                fetch(publicUrl),
                new Promise((_, reject) => 
                  setTimeout(() => reject(new Error('Download timeout')), 5000)
                )
              ]);
              
              if (response.ok) {
                const buffer = await response.arrayBuffer();
                const uint8Array = new Uint8Array(buffer);
                
                dimensions = parseImageDimensions(uint8Array, imageFile.name);
                
                if (dimensions) {
                  console.log(`✅ Dimensions: ${dimensions.width}x${dimensions.height}`);
                } else {
                  console.log(`⚠️ Could not parse dimensions for ${imageFile.name}`);
                }
              }
            } catch (dimError) {
              console.warn(`Dimension calculation failed for ${imageFile.name}: ${dimError.message}`);
            }
          }
        } else {
          console.log(`Skipping dimension calculation for ${imageFile.extension} file: ${imageFile.name}`);
        }
        
        // Prepare database record
        const updateData = {
          name: imageFile.name,
          project: imageFile.project,
          tool: imageFile.tool,
          type: 'image',
          time: '2024-Q1', // Default
          extension: imageFile.extension,
          storage_url: publicUrl,
          storage_path: imageFile.fullPath,
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
          // Update existing
          const { error: updateError } = await supabase
            .from('portfolio_images')
            .update(updateData)
            .eq('id', existingImage.id);
          
          if (updateError) {
            throw new Error(`Update failed: ${updateError.message}`);
          }
          
          updated++;
          console.log(`✅ Updated: ${imageFile.fullPath}`);
        } else {
          // Create new
          const { error: insertError } = await supabase
            .from('portfolio_images')
            .insert(updateData);
          
          if (insertError) {
            throw new Error(`Insert failed: ${insertError.message}`);
          }
          
          created++;
          console.log(`✅ Created: ${imageFile.fullPath}`);
        }
        
        processed++;
        results.push({
          path: imageFile.fullPath,
          status: 'success',
          action: existingImage ? 'updated' : 'created',
          dimensions: dimensions ? `${dimensions.width}x${dimensions.height}` : 'not calculated',
          extension: imageFile.extension,
          project: imageFile.project,
          tool: imageFile.tool
        });
        
      } catch (error) {
        console.error(`❌ Failed to process ${imageFile.fullPath}:`, error.message);
        failed++;
        results.push({
          path: imageFile.fullPath,
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
    
    const hasMoreImages = allImageFiles.length > 3;
    const remainingImages = Math.max(0, allImageFiles.length - 3);
    
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
        hasMoreImages: hasMoreImages,
        remainingImages: remainingImages,
        message: processed > 0 ? 
          `Processed ${processed} images: ${created} created, ${updated} updated, ${failed} failed. ${totalInStorage} total in storage, ${withDimensions} with dimensions.` +
          (hasMoreImages ? ` ${remainingImages} images remaining - run again to continue.` : '') :
          `Scan complete: ${totalInStorage} images already in database`,
        continueUrl: hasMoreImages ? '/.netlify/functions/working-sync-bucket' : null,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('Working sync error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};