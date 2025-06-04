// netlify/functions/deep-folder-scanner.js
// Scan deeper folder structure to find actual image files

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== DEEP FOLDER SCANNER START ===');
  
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
    
    // Scan structure: project/tool/files
    console.log('Scanning deep folder structure...');
    
    const { data: projects, error: projectsError } = await supabase.storage
      .from('portfolio-images')
      .list('', { limit: 50 });
    
    if (projectsError) {
      throw new Error(`Projects list failed: ${projectsError.message}`);
    }
    
    console.log(`✅ Found ${projects.length} projects`);
    
    let allImageFiles = [];
    let scanResults = [];
    
    // Scan first 3 projects to find images
    for (let i = 0; i < Math.min(3, projects.length); i++) {
      const project = projects[i];
      
      if (project.metadata) continue; // Skip files in root
      
      console.log(`Scanning project: ${project.name}`);
      
      try {
        // Get tools in this project
        const { data: tools, error: toolsError } = await supabase.storage
          .from('portfolio-images')
          .list(project.name, { limit: 50 });
        
        if (toolsError) {
          console.error(`Tools list failed for ${project.name}:`, toolsError);
          continue;
        }
        
        console.log(`  Found ${tools.length} tools in ${project.name}`);
        
        for (const tool of tools) {
          if (tool.metadata) {
            // It's a file directly in project folder
            const ext = tool.name.split('.').pop()?.toLowerCase();
            if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) {
              allImageFiles.push({
                name: tool.name,
                path: `${project.name}/${tool.name}`,
                project: project.name,
                tool: 'root',
                size: tool.metadata.size
              });
            }
          } else {
            // It's a tool folder, scan it
            console.log(`    Scanning tool: ${project.name}/${tool.name}`);
            
            try {
              const { data: files, error: filesError } = await supabase.storage
                .from('portfolio-images')
                .list(`${project.name}/${tool.name}`, { limit: 100 });
              
              if (filesError) {
                console.error(`Files list failed for ${project.name}/${tool.name}:`, filesError);
                continue;
              }
              
              console.log(`      Found ${files.length} files in ${project.name}/${tool.name}`);
              
              for (const file of files) {
                if (file.metadata && file.metadata.size > 0) {
                  const ext = file.name.split('.').pop()?.toLowerCase();
                  if (['jpg', 'jpeg', 'png', 'gif', 'avif', 'webp'].includes(ext)) {
                    allImageFiles.push({
                      name: file.name,
                      path: `${project.name}/${tool.name}/${file.name}`,
                      project: project.name,
                      tool: tool.name,
                      size: file.metadata.size,
                      extension: ext
                    });
                  }
                }
              }
            } catch (toolError) {
              console.error(`Error scanning tool ${project.name}/${tool.name}:`, toolError);
            }
          }
        }
        
        scanResults.push({
          project: project.name,
          toolCount: tools.length,
          status: 'scanned'
        });
        
      } catch (projectError) {
        console.error(`Error scanning project ${project.name}:`, projectError);
        scanResults.push({
          project: project.name,
          status: 'failed',
          error: projectError.message
        });
      }
    }
    
    console.log(`✅ Total images found: ${allImageFiles.length}`);
    
    // Test one image URL
    let testUrl = null;
    if (allImageFiles.length > 0) {
      const testImage = allImageFiles[0];
      const { data: urlData } = supabase.storage
        .from('portfolio-images')
        .getPublicUrl(testImage.path);
      
      testUrl = {
        path: testImage.path,
        url: urlData.publicUrl,
        preview: urlData.publicUrl.substring(0, 80) + '...'
      };
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Deep scan completed - found ${allImageFiles.length} images`,
        summary: {
          totalProjects: projects.length,
          scannedProjects: scanResults.length,
          totalImages: allImageFiles.length,
          imagesByExtension: allImageFiles.reduce((acc, img) => {
            acc[img.extension] = (acc[img.extension] || 0) + 1;
            return acc;
          }, {})
        },
        scanResults: scanResults,
        sampleImages: allImageFiles.slice(0, 10).map(img => ({
          name: img.name,
          path: img.path,
          project: img.project,
          tool: img.tool,
          size: img.size,
          extension: img.extension
        })),
        testUrl: testUrl,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('❌ Deep scanner error:', error);
    
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