// netlify/functions/get-portfolio.js
// Updated to ONLY use Supabase Storage URLs, never expired Dropbox URLs

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== GET PORTFOLIO FUNCTION START ===');
  
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
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
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
    
    // Get all images - prioritize those with storage URLs
    const { data, error } = await supabase
      .from('portfolio_images')
      .select('*')
      .order('migrated_to_storage', { ascending: false, nullsLast: true })
      .order('modified', { ascending: false });
    
    if (error) {
      console.error('Supabase error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Database query failed',
          message: error.message
        })
      };
    }
    
    // Process images - ONLY use Supabase Storage URLs, filter out expired Dropbox URLs
    const images = (data || [])
      .filter(img => img.storage_url) // Only include images with Supabase Storage URLs
      .map(img => ({
        id: img.id,
        name: img.name || 'Untitled',
        project: img.project || 'Unknown Project',
        tool: img.tool || 'Unknown Tool',
        type: img.type || 'Unknown Type',
        time: img.time || '2024-Q1',
        aspectratio: parseFloat(img.aspectratio) || 1.33,
        image_url: img.storage_url, // ONLY use Supabase Storage URLs
        has_storage_url: true,
        has_dropbox_url: !!img.image_url,
        storage_path: img.storage_path,
        modified: img.modified
      }));
    
    // Get counts for remaining migration work
    const { data: unmigrated } = await supabase
      .from('portfolio_images')
      .select('id')
      .is('storage_url', null)
      .not('path', 'is', null);
    
    const stats = {
      total: images.length,
      withStorageUrls: images.length, // All images in response have storage URLs
      unmigratedCount: unmigrated?.length || 0
    };
    
    console.log(`Portfolio stats:`, stats);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        images: images,
        stats: stats,
        message: stats.unmigratedCount > 0 ? 
          `Retrieved ${images.length} migrated images. ${stats.unmigratedCount} images still need migration.` :
          `Retrieved ${images.length} images - all migrated to Supabase Storage!`,
        migrationNeeded: stats.unmigratedCount > 0,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('Function error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Function execution failed',
        message: error.message
      })
    };
  }
};