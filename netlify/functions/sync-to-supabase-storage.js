// netlify/functions/sync-to-supabase-storage.js
// Function to download images from Dropbox and upload to Supabase Storage

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== SUPABASE STORAGE SYNC START ===');
  
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
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get images that don't have permanent storage URLs yet
    const { data: images, error } = await supabase
      .from('portfolio_images')
      .select('*')
      .or('storage_url.is.null,storage_url.eq.')
      .not('path', 'is', null)
      .limit(10); // Process 10 at a time to avoid timeout
    
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
    
    let uploaded = 0;
    let failed = 0;
    const results = [];
    
    for (const image of images) {
      try {
        console.log(`Processing: ${image.name}`);
        
        // First, get a fresh temporary URL from Dropbox
        const tempUrlResponse = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${dropboxToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ path: image.path })
        });
        
        if (!tempUrlResponse.ok) {
          throw new Error(`Failed to get Dropbox URL: ${tempUrlResponse.status}`);
        }
        
        const tempUrlData = await tempUrlResponse.json();
        const dropboxUrl = tempUrlData.link;
        
        // Download the image from Dropbox
        console.log(`Downloading: ${image.name}`);
        const imageResponse = await fetch(dropboxUrl);
        
        if (!imageResponse.ok) {
          throw new Error(`Failed to download image: ${imageResponse.status}`);
        }
        
        const imageBuffer = await imageResponse.arrayBuffer();
        const imageUint8Array = new Uint8Array(imageBuffer);
        
        // Create a clean filename
        const fileExtension = image.extension || 'jpg';
        const cleanName = image.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const fileName = `${image.project}/${image.tool}/${cleanName}.${fileExtension}`.replace(/[^a-zA-Z0-9-_./]/g, '-');
        
        console.log(`Uploading to Supabase Storage: ${fileName}`);
        
        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('portfolio-images')
          .upload(fileName, imageUint8Array, {
            contentType: `image/${fileExtension}`,
            upsert: true
          });
        
        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }
        
        // Get the public URL
        const { data: urlData } = supabase.storage
          .from('portfolio-images')
          .getPublicUrl(fileName);
        
        const publicUrl = urlData.publicUrl;
        
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
          throw new Error(`Database update failed: ${updateError.message}`);
        }
        
        uploaded++;
        results.push({
          name: image.name,
          status: 'success',
          url: publicUrl
        });
        
        console.log(`✅ Successfully migrated: ${image.name}`);
        
        // Small delay to avoid overwhelming the services
        await new Promise(resolve => setTimeout(resolve, 200));
        
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
          'No images needed migration',
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