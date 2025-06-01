const { createClient } = require('@supabase/supabase-js');

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
    
    console.log('Connecting to Supabase...');
    
    // Initialize Supabase client
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Query the database
    const { data: images, error } = await supabase
      .from('portfolio_images')
      .select('*')
      .order('modified', { ascending: false });
    
    if (error) {
      console.error('Database error:', error);
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: error.message
        })
      };
    }
    
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