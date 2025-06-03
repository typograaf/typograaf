// netlify/functions/refresh-image-urls.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== REFRESH IMAGE URLS START ===');
  
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
    // Get environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
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
    
    // Get request body
    const requestBody = event.body ? JSON.parse(event.body) : {};
    const imageIds = requestBody.imageIds || [];
    
    if (imageIds.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'No image IDs provided'
        })
      };
    }
    
    console.log(`Refreshing URLs for ${imageIds.length} images`);
    
    // Get the images that need URL refresh
    const { data: images, error } = await supabase
      .from('portfolio_images')
      .select('*')
      .in('id', imageIds);
    
    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }
    
    const refreshedImages = [];
    
    // Process each image
    for (const image of images) {
      if (!image.path) {
        console.log(`Skipping ${image.name} - no path`);
        continue;
      }
      
      try {
        // Generate new temporary URL
        const newUrl = await getDropboxTemporaryUrl(dropboxToken, image.path);
        
        if (newUrl) {
          // Update the database
          const { error: updateError } = await supabase
            .from('portfolio_images')
            .update({ 
              image_url: newUrl,
              modified: new Date().toISOString()
            })
            .eq('id', image.id);
          
          if (!updateError) {
            refreshedImages.push({
              id: image.id,
              name: image.name,
              newUrl: newUrl
            });
            console.log(`Refreshed URL for: ${image.name}`);
          }
        }
      } catch (error) {
        console.error(`Failed to refresh ${image.name}:`, error.message);
      }
    }
    
    console.log(`Successfully refreshed ${refreshedImages.length} URLs`);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        refreshed: refreshedImages.length,
        images: refreshedImages,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('Refresh function error:', error);
    
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
      console.error(`Failed to get temporary URL for ${path}: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    return data.link;
  } catch (error) {
    console.error(`Error getting temporary URL for ${path}:`, error.message);
    return null;
  }
}