// netlify/functions/generate-image-urls.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== GENERATE IMAGE URLS START ===');
  
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN;
    
    if (!supabaseUrl || !supabaseKey || !dropboxToken) {
      throw new Error('Missing environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get images without URLs
    const { data: images, error } = await supabase
      .from('portfolio_images')
      .select('id, path')
      .is('image_url', null)
      .limit(5); // Process 5 at a time
    
    if (error) throw error;
    
    console.log(`Found ${images.length} images needing URLs`);
    
    if (images.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          message: 'All images already have URLs',
          processed: 0
        })
      };
    }
    
    let processed = 0;
    
    for (const image of images) {
      try {
        console.log(`Generating URL for: ${image.path}`);
        const imageUrl = await getDropboxTemporaryUrl(dropboxToken, image.path);
        
        if (imageUrl) {
          await supabase
            .from('portfolio_images')
            .update({ image_url: imageUrl })
            .eq('id', image.id);
          
          processed++;
          console.log(`Updated URL for ${image.id}`);
        }
      } catch (error) {
        console.error(`Failed to process ${image.path}:`, error.message);
      }
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        processed: processed,
        remaining: images.length - processed,
        message: `Generated ${processed} URLs`
      })
    };
    
  } catch (error) {
    console.error('=== URL GENERATION ERROR ===', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};

async function getDropboxTemporaryUrl(token, path) {
  try {
    const response = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ path })
    });
    
    if (!response.ok) {
      console.error(`Failed to get URL for ${path}: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    return data.link;
  } catch (error) {
    console.error(`Error getting URL for ${path}:`, error.message);
    return null;
  }
}