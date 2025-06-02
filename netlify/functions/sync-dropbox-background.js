// netlify/functions/sync-dropbox-background.js
exports.handler = async (event, context) => {
  console.log('=== FUNCTION START ===');
  
  try {
    // Check environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    console.log('Environment check:');
    console.log('- SUPABASE_URL exists:', !!supabaseUrl);
    console.log('- SUPABASE_ANON_KEY exists:', !!supabaseKey);
    
    if (!supabaseUrl || !supabaseKey) {
      console.log('=== MISSING ENVIRONMENT VARIABLES ===');
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: 'Missing Supabase configuration',
          debug: {
            hasUrl: !!supabaseUrl,
            hasKey: !!supabaseKey
          }
        })
      };
    }
    
    console.log('=== CALLING SUPABASE ===');
    console.log('URL:', supabaseUrl.substring(0, 30) + '...');
    
    // Call Supabase
    const response = await fetch(`${supabaseUrl}/rest/v1/portfolio_images?select=*&order=modified.desc`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Supabase response status:', response.status);
    console.log('Supabase response ok:', response.ok);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('=== SUPABASE ERROR ===');
      console.error('Status:', response.status);
      console.error('Error:', errorText);
      
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: `Supabase API error: ${response.status}`,
          details: errorText
        })
      };
    }
    
    const images = await response.json();
    console.log('=== SUPABASE SUCCESS ===');
    console.log('Images found:', images.length);
    
    // Handle empty database gracefully
    const stats = {
      totalImages: images.length,
      imagesWithUrls: images.filter(img => img.image_url).length,
      imagesWithoutUrls: images.filter(img => !img.image_url).length,
      source: 'database',
      isEmpty: images.length === 0
    };
    
    const projects = [...new Set(images.map(img => img.project))].filter(Boolean);
    
    console.log('=== RETURNING SUCCESS RESPONSE ===');
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      },
      body: JSON.stringify({
        success: true,
        images: images, // Will be empty array if no data
        stats: stats,
        projects: projects,
        message: images.length === 0 ? 'Database is empty - no images found' : `Found ${images.length} images`,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('=== FUNCTION ERROR ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};