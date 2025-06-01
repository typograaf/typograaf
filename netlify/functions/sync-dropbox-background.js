exports.handler = async (event, context) => {
  try {
    console.log('Function started');
    
    // Check environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing environment variables');
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: 'Missing Supabase configuration'
        })
      };
    }
    
    console.log('Fetching from Supabase...');
    
    // Use fetch API instead of Supabase client
    const response = await fetch(`${supabaseUrl}/rest/v1/portfolio_images?select=*&order=modified.desc`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Supabase API error:', response.status, errorText);
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: `Supabase API error: ${response.status} ${response.statusText}`
        })
      };
    }
    
    const images = await response.json();
    console.log(`Found ${images.length} images`);
    
    // Calculate statistics
    const stats = {
      totalImages: images.length,
      imagesWithUrls: images.filter(img => img.image_url).length,
      imagesWithoutUrls: images.filter(img => !img.image_url).length,
      source: 'database'
    };
    
    // Get unique projects
    const projects = [...new Set(images.map(img => img.project))].filter(Boolean);
    
    console.log('Returning response');
    
    // Return successful response
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
        images: images,
        stats: stats,
        projects: projects,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('Function error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};