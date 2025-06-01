// netlify/functions/check-database.js
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

exports.handler = async (event, context) => {
  try {
    console.log('Checking database contents...');
    
    // Get all images
    const allResponse = await supabaseRequest('GET', '/rest/v1/portfolio_images?select=*&order=project,name');
    
    if (allResponse.status !== 200) {
      const errorText = await allResponse.text();
      throw new Error(`Failed to fetch images: ${allResponse.status} - ${errorText}`);
    }
    
    const allImages = await allResponse.json();
    console.log(`Found ${allImages.length} total images`);
    
    // Group by project
    const projectGroups = {};
    allImages.forEach(img => {
      if (!projectGroups[img.project]) {
        projectGroups[img.project] = [];
      }
      projectGroups[img.project].push(img);
    });
    
    // Summary by project
    const projectSummary = Object.keys(projectGroups).map(project => ({
      project: project,
      count: projectGroups[project].length,
      hasUrls: projectGroups[project].filter(img => img.image_url).length,
      noUrls: projectGroups[project].filter(img => !img.image_url).length,
      sampleImage: projectGroups[project][0]?.name || 'none'
    }));
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        summary: {
          totalImages: allImages.length,
          totalProjects: Object.keys(projectGroups).length,
          imagesWithUrls: allImages.filter(img => img.image_url).length,
          imagesWithoutUrls: allImages.filter(img => !img.image_url).length
        },
        projectBreakdown: projectSummary.sort((a, b) => b.count - a.count),
        sampleImages: allImages.slice(0, 3).map(img => ({
          id: img.id,
          name: img.name,
          project: img.project,
          hasUrl: !!img.image_url,
          scanned: img.scanned
        })),
        timestamp: new Date().toISOString()
      }, null, 2)
    };
    
  } catch (error) {
    console.error('Check database error:', error);
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

async function supabaseRequest(method, endpoint, data = null) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    
    const options = {
      hostname: new URL(SUPABASE_URL).hostname,
      port: 443,
      path: endpoint,
      method: method,
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    
    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }
    
    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        res.text = () => responseData;
        res.json = () => {
          try {
            return JSON.parse(responseData);
          } catch (e) {
            return null;
          }
        };
        resolve(res);
      });
    });
    
    req.on('error', (error) => {
      reject(new Error(`Supabase request error: ${error.message}`));
    });
    
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}