// Content script to analyze page content

// Variables to store analysis results
let safetyAnalysis = null;
let redactedElements = new Map();
let analysisInProgress = false;
let analysisCompleted = false;

// When the page loads, analyze the content
window.addEventListener('load', () => {
  // Delay to ensure page content is fully loaded
  setTimeout(initialAnalysis, 1500);
  
  // Setup context menu for redacted content
  setupRedactionContextMenu();
});

// Function to check if the extension is enabled for this site
function isExtensionEnabled() {
  return new Promise(resolve => {
    const hostname = window.location.hostname;
    
    chrome.storage.sync.get('disabledSites', function(data) {
      const disabledSites = data.disabledSites || [];
      resolve(!disabledSites.includes(hostname));
    });
  });
}

// Initial analysis on page load
async function initialAnalysis() {
  // Check if extension is enabled for this site
  const isEnabled = await isExtensionEnabled();
  
  if (!isEnabled) {
    console.log("Extension is disabled for this site");
    return;
  }
  
  if (!analysisCompleted && !analysisInProgress) {
    analyzePageContent();
  }
}

// Setup context menu for redacted content
function setupRedactionContextMenu() {
  // Create a custom right-click menu item
  chrome.runtime.sendMessage({
    action: "createContextMenu",
    id: "revealRedactedContent",
    title: "Reveal Redacted Content"
  });
}

// Add event listener for context menu on redacted content
document.addEventListener('contextmenu', function(e) {
  // Check if clicking on a redacted element
  let element = e.target;
  if (element.classList.contains('redacted-content')) {
    // Mark the element as selected
    // Clear any previously selected elements
    document.querySelectorAll('.redacted-content[data-selected="true"]').forEach(el => {
      el.removeAttribute('data-selected');
    });
    
    // Mark this element as selected and add active class to prevent tooltip
    element.dataset.selected = 'true';
    element.classList.add('active');
  }
}, false);

// Function to analyze page content
async function analyzePageContent() {
  // Check if extension is enabled for this site
  const isEnabled = await isExtensionEnabled();
  
  if (!isEnabled) {
    console.log("Extension is disabled for this site");
    return false;
  }
  
  // Prevent multiple simultaneous analyses
  if (analysisInProgress) {
    console.log("Analysis already in progress, ignoring request");
    return false;
  }
  
  // Skip if already analyzed
  if (analysisCompleted && safetyAnalysis) {
    console.log("Page already analyzed, showing existing results");
    showSafetyScore(safetyAnalysis.safetyScore);
    return true;
  }
  
  analysisInProgress = true;
  console.log("Analyzing page content...");
  
  // Get the main content of the page
  const contentElements = document.querySelectorAll('p, div, span, article, section');
  let pageContent = '';
  
  // Extract text content
  contentElements.forEach(element => {
    if (element.textContent.trim().length > 0) {
      pageContent += element.textContent + '\n';
    }
  });
  
  // Limit content size for API
  const MAX_CONTENT_LENGTH = 10000;
  if (pageContent.length > MAX_CONTENT_LENGTH) {
    pageContent = pageContent.substring(0, MAX_CONTENT_LENGTH);
  }
  
  // Send content to background script for analysis
  chrome.runtime.sendMessage(
    { action: "analyzeContent", content: pageContent },
    handleAnalysisResponse
  );
  
  return true; // Indicate success
}

// Handle the analysis response
function handleAnalysisResponse(response) {
  analysisInProgress = false;
  
  if (!response) {
    console.error("No response received from analysis");
    showNotification("Error: No response received");
    return;
  }
  
  if (response.error) {
    console.error("Analysis error:", response.error);
    showNotification("Error analyzing page: " + response.error);
    return;
  }
  
  console.log("Analysis response received:", response);
  
  // Store the analysis results
  safetyAnalysis = response;
  analysisCompleted = true;
  
  // Show the safety score notification
  showSafetyScore(response.safetyScore);
  
  // Highlight and redact problematic content
  if (response.issues && response.issues.length > 0) {
    highlightProblematicContent(response.issues);
  }
}

// Show safety score notification with dark mode support
function showSafetyScore(score) {
  // Remove any existing notifications first
  const existingNotification = document.querySelector('.safety-notification');
  if (existingNotification) {
    existingNotification.remove();
  }

  const notification = document.createElement('div');
  notification.className = 'safety-notification';
  
  let safetyLevel = "Unknown";
  let color = "#888";
  
  if (score >= 80) {
    safetyLevel = "Safe";
    color = "#4CAF50";
  } else if (score >= 60) {
    safetyLevel = "Moderate";
    color = "#FFC107";
  } else {
    safetyLevel = "Potentially Unsafe";
    color = "#F44336";
  }
  
  // Adjust text color for better visibility in dark mode
  let textColor = 'white';
  let btnBgColor = isDarkMode() ? '#e1e1e1' : 'rgba(255, 255, 255, 0.8)';
  let btnTextColor = isDarkMode() ? color : '#333';
  
  notification.innerHTML = `
    <div style="padding: 15px; background-color: ${color}; color: ${textColor}; 
                border-radius: 5px; box-shadow: 0 2px 10px rgba(0,0,0,0.2);">
      <h3>Safety Score: ${score}/100</h3>
      <p>This page is rated: ${safetyLevel}</p>
      <button id="details-btn" style="background-color: ${btnBgColor}; color: ${btnTextColor};">View Details</button>
    </div>
  `;
  
  document.body.appendChild(notification);
  
  // Position the notification in the top-right corner
  Object.assign(notification.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    zIndex: '10000'
  });
  
  // Add event listener to the details button
  document.getElementById('details-btn').addEventListener('click', () => {
    showDetailedAnalysis(safetyAnalysis);
  });
  
  // Auto-hide after 10 seconds
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => notification.remove(), 1000);
  }, 10000);
}

// Highlight and redact problematic content
function highlightProblematicContent(issues) {
  if (!issues || issues.length === 0) return;
  
  // For each issue, find and highlight the text
  issues.forEach(issue => {
    // Look for the issue text in the document
    findAndHighlightText(issue.text, issue.reason);
  });
  
  // If issues were found and the score is below the "safe" threshold, show warning popup
  if (redactedElements.size > 0 && safetyAnalysis.safetyScore < 80) {
    showWarningPopup(issues.length);
  }
}

// Find and highlight specific text in the document
function findAndHighlightText(text, reason) {
  if (!text || text.trim() === '') {
    console.warn("Empty text provided for highlighting");
    return;
  }
  
  // Escape special characters in the text for safe usage in RegExp
  const escapeRegExp = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };
  
  const escapedText = escapeRegExp(text);
  console.log(`Finding and highlighting text: "${text}" with reason: ${reason}`);
  
  const textNodes = [];
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  let node;
  while (node = walker.nextNode()) {
    if (node.nodeValue.includes(text)) {
      textNodes.push(node);
    }
  }
  
  console.log(`Found ${textNodes.length} text nodes containing the target text`);
  
  // Process each text node
  textNodes.forEach(node => {
    const parent = node.parentElement;
    if (!parent) return;
    
    // Create a document fragment to hold the new content
    const fragment = document.createDocumentFragment();
    
    // Get the text content and create a regex that matches the target text
    const content = node.nodeValue;
    const regex = new RegExp(escapedText, 'g');
    
    // Split the content and preserve the original formatting
    let lastIndex = 0;
    let match;
    
    // Use regex to find all instances of the text
    while ((match = regex.exec(content)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(content.substring(lastIndex, match.index)));
      }
      
      // Create the redacted element
      const wrapper = document.createElement('span');
      wrapper.className = 'redacted-content';
      wrapper.setAttribute('data-reason', reason);
      wrapper.setAttribute('data-original', match[0]); // Add original text for hover
      wrapper.textContent = '█'.repeat(match[0].length);
      
      // Store original content for potential unredaction
      const id = 'redacted-' + Math.random().toString(36).substr(2, 9);
      wrapper.id = id;
      redactedElements.set(id, { 
        originalText: match[0], 
        reason: reason
      });
      
      // Add event listener for right-click
      wrapper.addEventListener('contextmenu', (e) => {
        e.preventDefault(); // Prevent the default context menu
        
        // Clear any previously selected elements
        document.querySelectorAll('.redacted-content[data-selected="true"]').forEach(el => {
          el.removeAttribute('data-selected');
          el.classList.remove('active');
        });
        
        wrapper.dataset.selected = 'true';
        wrapper.classList.add('active');
      });
      
      fragment.appendChild(wrapper);
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text after the last match
    if (lastIndex < content.length) {
      fragment.appendChild(document.createTextNode(content.substring(lastIndex)));
    }
    
    // Replace the original node with our new fragment
    parent.replaceChild(fragment, node);
  });
}

// Show warning popup about detected issues
function showWarningPopup(issueCount) {
  const popup = document.createElement('div');
  popup.className = 'warning-popup';
  
  const innerDiv = document.createElement('div');
  innerDiv.style.cssText = `
    padding: 20px; 
    background-color: var(--warning-bg); 
    color: var(--warning-text); 
    border-radius: 5px; 
    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    position: relative;
    z-index: 10002;
  `;
  
  // Apply explicit colors as fallback if CSS variables aren't working
  if (isDarkMode()) {
    innerDiv.style.backgroundColor = '#b33939';
    innerDiv.style.color = '#ffffff';
  } else {
    innerDiv.style.backgroundColor = '#ff4444';
    innerDiv.style.color = '#ffffff';
  }
  
  innerDiv.innerHTML = `
    <h3>⚠️ Warning: Potentially Harmful Content Detected</h3>
    <p>This page contains ${issueCount} instances of potentially harmful content 
       including possible cyberbullying or other concerning material.</p>
    <p>These instances have been redacted for your safety. Hover over any redacted content to preview it.</p>
    <p>Right-click on any redacted content and select "Reveal Redacted Content" to permanently unredact it.</p>
  `;
  
  const acknowledgeBtn = document.createElement('button');
  acknowledgeBtn.id = 'acknowledge-btn';
  acknowledgeBtn.textContent = 'I Understand';
  acknowledgeBtn.style.cssText = `
    background-color: white;
    color: #ff4444;
    padding: 8px 16px;
    margin: 5px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: bold;
    z-index: 10003;
  `;
  
  innerDiv.appendChild(acknowledgeBtn);
  popup.appendChild(innerDiv);
  
  document.body.appendChild(popup);
  
  // Position the popup in the center
  Object.assign(popup.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: '10001',
    width: '80%',
    maxWidth: '500px'
  });
  
  // Add event listener to the acknowledge button with explicit binding
  acknowledgeBtn.addEventListener('click', function() {
    console.log("Acknowledge button clicked");
    document.body.removeChild(popup);
  });
}

// Show detailed analysis with dark mode support
function showDetailedAnalysis(analysis) {
  const panel = document.createElement('div');
  panel.className = 'analysis-panel';
  
  let bgColor = isDarkMode() ? '#2d2d2d' : 'white';
  let textColor = isDarkMode() ? '#e1e1e1' : 'black';
  
  let issuesHtml = '';
  if (analysis.issues && analysis.issues.length > 0) {
    issuesHtml = '<h4>Detected Issues:</h4><ul>' + 
      analysis.issues.map(issue => 
        `<li><strong>Text:</strong> "${issue.text}"<br>
         <strong>Reason:</strong> ${issue.reason}</li>`
      ).join('') + '</ul>';
  } else {
    issuesHtml = '<p>No specific issues detected.</p>';
  }
  
  panel.innerHTML = `
    <div style="padding: 20px; background-color: ${bgColor}; color: ${textColor}; 
                border-radius: 5px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                max-width: 600px; max-height: 80vh; overflow-y: auto;">
      <h3>Safety Analysis Results</h3>
      <p><strong>Safety Score:</strong> ${analysis.safetyScore}/100</p>
      ${issuesHtml}
      <button id="export-btn">Export for Law Enforcement</button>
      <button id="close-analysis-btn">Close</button>
    </div>
  `;
  
  document.body.appendChild(panel);
  
  // Position the panel in the center
  Object.assign(panel.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: '10002'
  });
  
  // Add event listeners
  document.getElementById('close-analysis-btn').addEventListener('click', () => {
    panel.remove();
  });
  
  document.getElementById('export-btn').addEventListener('click', () => {
    exportEvidenceReport();
  });
}

// Function to check if browser is in dark mode
function isDarkMode() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// Export evidence for law enforcement
function exportEvidenceReport() {
  if (!safetyAnalysis) {
    showNotification("No analysis data available to export");
    return;
  }
  
  // Determine color scheme based on safety score
  let safetyColor = "#888";
  let safetyStatus = "Unknown";
  
  if (safetyAnalysis.safetyScore >= 80) {
    safetyColor = "#4CAF50";
    safetyStatus = "Safe";
  } else if (safetyAnalysis.safetyScore >= 60) {
    safetyColor = "#FFC107";
    safetyStatus = "Moderate";
  } else {
    safetyColor = "#F44336";
    safetyStatus = "Potentially Unsafe";
  }
  
  // Create HTML content with styling
  let htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Web Safety Analysis Report</title>
      <style>
        :root {
          --background-color: #ffffff;
          --text-color: #333333;
          --secondary-text-color: #666666;
          --border-color: #e0e0e0;
          --card-bg: #f9f9f9;
          --safety-color: ${safetyColor};
        }
        
        @media (prefers-color-scheme: dark) {
          :root {
            --background-color: #202124;
            --text-color: #e8eaed;
            --secondary-text-color: #9aa0a6;
            --border-color: #3c4043;
            --card-bg: #2d2d2d;
          }
        }
        
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: var(--text-color);
          background-color: var(--background-color);
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
        }
        
        header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 20px;
        }
        
        h1, h2, h3 {
          color: var(--text-color);
        }
        
        .score-container {
          display: flex;
          justify-content: center;
          align-items: center;
          margin: 20px 0;
        }
        
        .score {
          font-size: 48px;
          font-weight: bold;
          color: ${safetyColor};
          margin: 0 15px;
        }
        
        .score-label {
          font-size: 24px;
          color: var(--secondary-text-color);
        }
        
        .status-badge {
          display: inline-block;
          padding: 5px 15px;
          background-color: ${safetyColor};
          color: white;
          border-radius: 20px;
          font-weight: bold;
          margin: 10px 0;
        }
        
        .card {
          background-color: var(--card-bg);
          border-radius: 5px;
          padding: 15px;
          margin-bottom: 20px;
          box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        
        .issue {
          border-left: 4px solid ${safetyColor};
          padding-left: 15px;
          margin-bottom: 15px;
        }
        
        .meta {
          color: var(--secondary-text-color);
          font-size: 14px;
        }
        
        .full-analysis {
          white-space: pre-line;
          border-top: 1px solid var(--border-color);
          margin-top: 30px;
          padding-top: 20px;
        }
        
        footer {
          margin-top: 30px;
          text-align: center;
          font-size: 12px;
          color: var(--secondary-text-color);
          border-top: 1px solid var(--border-color);
          padding-top: 20px;
        }
      </style>
    </head>
    <body>
      <header>
        <h1>Web Safety Analysis Report</h1>
        <div class="meta">
          Generated on ${new Date().toLocaleString()}
        </div>
      </header>
      
      <div class="card">
        <h3>Page Information</h3>
        <p><strong>URL:</strong> ${window.location.href}</p>
        <div class="score-container">
          <div class="score-label">Safety<br>Score</div>
          <div class="score">${safetyAnalysis.safetyScore}</div>
          <div class="score-label">out of<br>100</div>
        </div>
        <div style="text-align: center;">
          <div class="status-badge">${safetyStatus}</div>
        </div>
      </div>
      
      <div class="card">
        <h3>Identified Issues</h3>
  `;
  
  if (safetyAnalysis.issues && safetyAnalysis.issues.length > 0) {
    safetyAnalysis.issues.forEach((issue, index) => {
      htmlContent += `
        <div class="issue">
          <h4>Issue ${index + 1}</h4>
          <p><strong>Detected Text:</strong> "${issue.text}"</p>
          <p><strong>Reason:</strong> ${issue.reason}</p>
        </div>
      `;
    });
  } else {
    htmlContent += `<p>No specific issues identified.</p>`;
  }
  
  htmlContent += `
      </div>
      
      <div class="full-analysis">
        <h3>Full Analysis</h3>
        <div>${safetyAnalysis.fullAnalysis || "No detailed analysis available."}</div>
      </div>
      
      <footer>
        Report generated by Web Safety Analyzer | Powered by Gemini AI
      </footer>
    </body>
    </html>
  `;
  
  // Create a blob and download link for HTML
  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `safety-report-${new Date().toISOString().slice(0, 10)}.html`;
  a.click();
  
  URL.revokeObjectURL(url);
  
  showNotification("Report exported successfully");
}

// Remove redaction from an element
function removeRedaction(elementId) {
  let element;
  
  if (elementId) {
    element = document.getElementById(elementId);
  } else {
    // If no ID provided, look for selected element
    element = document.querySelector('.redacted-content[data-selected="true"]');
  }
  
  if (!element) return;
  
  const id = element.id;
  const data = redactedElements.get(id);
  
  if (data) {
    element.textContent = data.originalText;
    element.classList.add('unredacted');
    
    // Remove selection state and active class
    element.removeAttribute('data-selected');
    element.classList.remove('active');
  }
}

// Show a simple notification
function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'simple-notification';
  notification.textContent = message;
  
  Object.assign(notification.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    padding: '10px 20px',
    backgroundColor: '#333',
    color: 'white',
    borderRadius: '5px',
    zIndex: '10000'
  });
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Content script received message:", request.action);
  
  if (request.action === "removeRedaction") {
    removeRedaction();
    sendResponse({success: true});
  } else if (request.action === "updateEnabledState") {
    if (!request.isEnabled) {
      // Remove any existing UI elements if we're disabling
      const notification = document.querySelector('.safety-notification');
      if (notification) notification.remove();
      
      const popup = document.querySelector('.warning-popup');
      if (popup) popup.remove();
      
      const panel = document.querySelector('.analysis-panel');
      if (panel) panel.remove();
      
      // Reset analysis state
      analysisCompleted = false;
      safetyAnalysis = null;
    } else if (!analysisCompleted) {
      // If we're enabling and haven't analyzed yet, start analysis
      analyzePageContent();
    }
    
    sendResponse({success: true});
  } else if (request.action === "exportEvidence") {
    exportEvidenceReport();
    sendResponse({success: true});
  } else if (request.action === "getAnalysisStatus") {
    sendResponse({
      analyzed: analysisCompleted,
      safetyScore: safetyAnalysis ? safetyAnalysis.safetyScore : null
    });
  } else if (request.action === "analyzePageContent") {
    const success = analyzePageContent();
    sendResponse({success: success});
  } else if (request.action === "showDetailedAnalysis") {
    if (safetyAnalysis) {
      showDetailedAnalysis(safetyAnalysis);
      sendResponse({success: true});
    } else {
      showNotification("No analysis data available");
      sendResponse({success: false, message: "No analysis data available"});
    }
  }
  
  return true; // Indicates we'll respond asynchronously
});
