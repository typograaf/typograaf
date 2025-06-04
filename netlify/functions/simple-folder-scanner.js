// netlify/functions/simple-folder-scanner.js
// Super simple version to find the exact error

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== SIMPLE FOLDER SCANNER START ===');
  
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
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing environment variables');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ Supabase client created');
    
    // Step 1: List root level
    console.log('Step 1: Listing root level...');
    const { data: rootItems, error: rootError } = await supabase.storage
      .from('portfolio-images')
      .list('', { limit: 20 });
    
    if (rootError) {
      throw new Error(`Root list failed: ${rootError.message}`);
    }
    
    console.log(`✅ Found ${rootItems.length} items in root`);
    
    const results = {
      step1_root: {
        success: true,
        count: rootItems.length,
        items: rootItems.map(item => ({
          name: item.name,
          hasMetadata: !!item.metadata,
          size: item.metadata?.size,
          isFile: !!item.metadata
        }))
      }
    };
    
    // Step 2: Try to scan one folder
    const firstFolder = rootItems.find(item => !item.metadata);
    if (firstFolder) {
      console.log(`Step 2: Scanning folder "${firstFolder.name}"...`);
      
      try {
        const { data: folderItems, error: folderError } = await supabase.storage
          .from('portfolio-images')
          .list(firstFolder.name, { limit: 20 });
        
        if (folderError) {
          throw new Error(`Folder scan failed: ${folderError.message}`);
        }
        
        console.log(`✅ Found ${folderItems.length} items in "${firstFolder.name}"`);
        
        results.step2_firstFolder = {
          success: true,
          folderName: firstFolder.name,
          count: folderItems.length,
          items: folderItems.map(item => ({
            name: item.name,
            hasMetadata: !!item.metadata,
            size: item.metadata?.size,
            isFile: !!item.metadata
          }))
        };
        
        // Step 3: Look for actual image files
        const imageFiles = folderItems.filter(item => {
          if (!item.metadata) return false; // Skip folders
          const ext = item.name.split('.').pop()?.toLowerCase();
          return ['jpg', 'jpeg', 'png', 'gif'].includes(ext);
        });
        
        console.log(`✅ Found ${imageFiles.length} image files in "${firstFolder.name}"`);
        
        results.step3_imageFiles = {
          success: true,
          count: imageFiles.length,
          files: imageFiles.map(file => ({
            name: file.name,
            size: file.metadata.size,
            path: `${firstFolder.name}/${file.name}`
          }))
        };
        
        // Step 4: Try to get public URL for one image
        if (imageFiles.length > 0) {
          const firstImage = imageFiles[0];
          const imagePath = `${firstFolder.name}/${firstImage.name}`;
          
          console.log(`Step 4: Getting public URL for "${imagePath}"...`);
          
          const { data: urlData } = supabase.storage
            .from('portfolio-images')
            .getPublicUrl(imagePath);
          
          console.log(`✅ Public URL generated: ${urlData.publicUrl.substring(0, 50)}...`);
          
          results.step4_publicUrl = {
            success: true,
            imagePath: imagePath,
            publicUrl: urlData.publicUrl,
            urlPreview: urlData.publicUrl.substring(0, 80) + '...'
          };
        }
        
      } catch (folderError) {
        console.error(`❌ Folder scanning error:`, folderError);
        results.step2_firstFolder = {
          success: false,
          error: folderError.message
        };
      }
    } else {
      results.step2_firstFolder = {
        success: false,
        error: 'No folders found in root'
      };
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Folder scan completed successfully',
        results: results,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('❌ Scanner error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      })
    };
  }
};