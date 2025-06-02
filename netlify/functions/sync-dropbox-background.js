// netlify/functions/sync-dropbox-background.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== BACKGROUND FUNCTION START ===');
  
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
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('=== CALLING SUPABASE ===');
    console.log('URL:', supabaseUrl.substring(0, 30) + '...');
    
    // Get portfolio images from database
    const { data: images, error } = await supabase
      .from('portfolio_images')
      .select('*')
      .order('modified', { ascending: false });
    
    if (error) {
      console.error('=== SUPABASE ERROR ===');
      console.error('Error:', error);
      
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: `Supabase query error: ${error.message}`,
          details: error
        })
      };
    }
    
    console.log('=== SUPABASE SUCCESS ===');
    console.log('Images found:', images ? images.length : 0);
    
    // Handle empty database gracefully
    const stats = {
      totalImages: images ? images.length : 0,
      imagesWithUrls: images ? images.filter(img => img.image_url).length : 0,
      imagesWithoutUrls: images ? images.filter(img => !img.image_url).length : 0,
      source: 'database',
      isEmpty: !images || images.length === 0
    };
    
    const projects = images ? [...new Set(images.map(img => img.project))].filter(Boolean) : [];
    
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
        images: images || [],
        stats: stats,
        projects: projects,
        message: !images || images.length === 0 ? 'Database is empty - no images found' : `Found ${images.length} images`,
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
      