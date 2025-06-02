// netlify/functions/explore-dropbox.js
// TEMPORARY FUNCTION - DELETE AFTER USE

exports.handler = async (event, context) => {
  console.log('=== DROPBOX EXPLORER START ===');
  
  try {
    const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN;
    const dropboxRefreshToken = process.env.DROPBOX_REFRESH_TOKEN;
    const dropboxAppKey = process.env.DROPBOX_APP_KEY;
    const dropboxAppSecret = process.env.DROPBOX_APP_SECRET;
    
    if (!dropboxToken) {
      throw new Error('Missing DROPBOX_ACCESS_TOKEN');
    }
    
    // Try to get a fresh access token if we have refresh capability
    let currentToken = dropboxToken;
    
    if (dropboxRefreshToken && dropboxAppKey && dropboxAppSecret) {
      console.log('Attempting to refresh access token...');
      try {
        currentToken = await refreshAccessToken(dropboxRefreshToken, dropboxAppKey, dropboxAppSecret);
        console.log('Successfully refreshed access token');
      } catch (refreshError) {
        console.log('Failed to refresh token, using original:', refreshError.message);
        currentToken = dropboxToken;
      }
    }
    
    // Explore folder structure
    const exploration = await exploreDropboxStructure(currentToken);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        exploration: exploration,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('=== EXPLORATION ERROR ===', error);
    
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

async function refreshAccessToken(refreshToken, appKey, appSecret) {
  const credentials = Buffer.from(`${appKey}:${appSecret}`).toString('base64');
  
  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to refresh token: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  return data.access_token;
}

async function exploreDropboxStructure(token) {
  const exploration = {
    root: [],
    aboutContact: null,
    website: null,
    portfolio: null,
    errors: []
  };
  
  try {
    // Check root folder
    console.log('Exploring root folder...');
    exploration.root = await listDropboxFolder(token, '');
    console.log(`Found ${exploration.root.length} items in root`);
    
    // Look for AboutContact folder
    const aboutContactFolder = exploration.root.find(item => 
      item['.tag'] === 'folder' && item.name.toLowerCase().includes('about')
    );
    
    if (aboutContactFolder) {
      console.log(`Found AboutContact-like folder: ${aboutContactFolder.name}`);
      exploration.aboutContact = {
        name: aboutContactFolder.name,
        contents: await listDropboxFolder(token, aboutContactFolder.path_lower)
      };
      
      // Look for Website folder
      const websiteFolder = exploration.aboutContact.contents.find(item =>
        item['.tag'] === 'folder' && item.name.toLowerCase().includes('website')
      );
      
      if (websiteFolder) {
        console.log(`Found Website-like folder: ${websiteFolder.name}`);
        exploration.website = {
          name: websiteFolder.name,
          contents: await listDropboxFolder(token, websiteFolder.path_lower)
        };
        
        // Look for Portfolio folder
        const portfolioFolder = exploration.website.contents.find(item =>
          item['.tag'] === 'folder' && item.name.toLowerCase().includes('portfolio')
        );
        
        if (portfolioFolder) {
          console.log(`Found Portfolio-like folder: ${portfolioFolder.name}`);
          exploration.portfolio = {
            name: portfolioFolder.name,
            path: portfolioFolder.path_lower,
            contents: await listDropboxFolder(token, portfolioFolder.path_lower)
          };
          
          // Explore first few project folders
          const projectFolders = exploration.portfolio.contents.filter(item => item['.tag'] === 'folder');
          exploration.portfolio.projects = [];
          
          for (let i = 0; i < Math.min(3, projectFolders.length); i++) {
            const project = projectFolders[i];
            console.log(`Exploring project: ${project.name}`);
            
            try {
              const projectContents = await listDropboxFolder(token, project.path_lower);
              exploration.portfolio.projects.push({
                name: project.name,
                path: project.path_lower,
                contents: projectContents,
                toolFolders: projectContents.filter(item => item['.tag'] === 'folder').map(folder => ({
                  name: folder.name,
                  path: folder.path_lower
                }))
              });
            } catch (error) {
              exploration.errors.push(`Failed to explore project ${project.name}: ${error.message}`);
            }
          }
        } else {
          exploration.errors.push('No Portfolio folder found in Website folder');
        }
      } else {
        exploration.errors.push('No Website folder found in AboutContact folder');
      }
    } else {
      exploration.errors.push('No AboutContact folder found in root');
    }
    
  } catch (error) {
    exploration.errors.push(`Root exploration failed: ${error.message}`);
  }
  
  return exploration;
}

async function listDropboxFolder(token, path) {
  const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ path })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Dropbox API error: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  return data.entries || [];
}