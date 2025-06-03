// netlify/functions/sync-to-supabase-storage.js
// Fixed version that uses the working token directly

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== SUPABASE STORAGE SYNC START (FIXED) ===');
  
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
    const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN;
    
    if (!supabaseUrl || !supabaseKey || !dropboxToken) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Missing environment variables',
          needed: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DROPBOX_ACCESS_TOKEN']
        })
      };
    }
    
    console.log('Using Dropbox token:', dropboxToken.substring(0, 20) + '...');
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get images that don't have permanent storage URLs yet
    const { data: images, error } = await supabase
      .from('portfolio_images')
      .select('*')
      .or('storage_url.is.null,storage_url.eq.')
      .not('path', 'is', null)
      .limit(5); // Process 5 at a time to avoid timeout
    
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
    
    console.log(`Found ${images.length} images to migrate to Supabase Storage`);
    
    if (images.length === 0) {
      // Check if we already have migrated images
      const { data: allImages } = await supabase
        .from('portfolio_images')
        .select('storage_url')
        .not('storage_url', 'is', null)
        .limit(5);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          uploaded: 0,
          failed: 0,
          total: 0,
          message: allImages?.length > 0 ? 
            `All images already migrated! Found ${allImages.length} images in Supabase Storage.` :
            'No images found that need migration.',
          timestamp: new Date().toISOString()
        })
      };
    }
    
    let uploaded = 0;
    let failed = 0;
    const results = [];
    
    for (const image of images) {
      try {
        console.log(`Processing: ${image.name}`);
        
        // Use the working token directly - no refresh needed
        console.log(`Getting temporary URL for: ${image.path}`);
        const tempUrlResponse = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${dropboxToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ path: image.path })
        });
        
        console.log(`Dropbox API response status: ${tempUrlResponse.status}`);
        
        if (!tempUrlResponse.ok) {
          const errorText = await tempUrlResponse.text();
          console.error(`Dropbox API error:`, errorText);
          throw new Error(`Failed to get Dropbox URL: ${tempUrlResponse.status} - ${errorText}`);
        }
        
        const tempUrlData = await tempUrlResponse.json();
        const dropboxUrl = tempUrlData.link;
        console.log(`Got temporary URL: ${dropboxUrl.substring(0, 50)}...`);
        
        // Download the image from Dropbox
        console.log(`Downloading: ${image.name}`);
        const imageResponse = await fetch(dropboxUrl);
        
        if (!imageResponse.ok) {
          throw new Error(`Failed to download image: ${imageResponse.status}`);
        }
        
        const imageBuffer = await imageResponse.arrayBuffer();
        const imageUint8Array = new Uint8Array(imageBuffer);
        console.log(`Downloaded ${imageUint8Array.length} bytes`);
        
        // Create a clean filename
        const fileExtension = image.extension || 'jpg';
        const cleanName = image.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const cleanProject = image.project.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const cleanTool = image.tool.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const fileName = `${cleanProject}/${cleanTool}/${cleanName}.${fileExtension}`;
        
        console.log(`Uploading to Supabase Storage: ${fileName}`);
        
        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('portfolio-images')
          .upload(fileName, imageUint8Array, {
            contentType: `image/${fileExtension}`,
            upsert: true
          });
        
        if (uploadError) {
          console.error('Upload error:', uploadError);
          throw new Error(`Upload failed: ${uploadError.message}`);
        }
        
        console.log(`Upload successful:`, uploadData);
        
        // Get the public URL
        const { data: urlData } = supabase.storage
          .from('portfolio-images')
          .getPublicUrl(fileName);
        
        const publicUrl = urlData.publicUrl;
        console.log(`Public URL: ${publicUrl}`);
        
        // Update the database with the permanent storage URL
        const { error: updateError } = await supabase
          .from('portfolio_images')
          .update({
            storage_url: publicUrl,
            storage_path: fileName,
            migrated_to_storage: new Date().toISOString()
          })
          .eq('id', image.id);
        
        if (updateError) {
          console.error('Database update error:', updateError);
          throw new Error(`Database update failed: ${updateError.message}`);
        }
        
        uploaded++;
        results.push({
          name: image.name,
          status: 'success',
          url: publicUrl,
          path: fileName
        });
        
        console.log(`✅ Successfully migrated: ${image.name}`);
        
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
    
    console.log(`Migration complete: ${uploaded} uploaded, ${failed} failed`);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        uploaded: uploaded,
        failed: failed,
        total: images.length,
        results: results,
        message: uploaded > 0 ? 
          `Successfully migrated ${uploaded} images to Supabase Storage` :
          failed > 0 ? 
          `Failed to migrate ${failed} images - check the results for details` :
          'No images processed',
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('Storage sync error:', error);
    
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