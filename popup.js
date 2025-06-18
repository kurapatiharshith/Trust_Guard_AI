// Event listeners for popup buttons
document.addEventListener('DOMContentLoaded', function() {
  // Get elements
  const analyzeBtn = document.getElementById('analyze-btn');
  const viewReportBtn = document.getElementById('view-report-btn');
  const exportBtn = document.getElementById('export-btn');
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const scoreContainer = document.getElementById('score-container');
  const scoreElement = document.getElementById('score');
  const enableToggle = document.getElementById('enable-toggle');
  const toggleStatus = document.getElementById('toggle-status');
  
  // Settings elements
  const settingsIcon = document.getElementById('settings-icon');
  const settingsPanel = document.getElementById('settings-panel');
  const apiKeyInput = document.getElementById('api-key');
  const saveApiKeyBtn = document.getElementById('save-api-key');
  const apiKeyStatus = document.getElementById('api-key-status');
  
  // Toggle settings panel
  settingsIcon.addEventListener('click', function() {
    settingsPanel.classList.toggle('active');
    
    // Load saved API key when settings panel is opened
    if (settingsPanel.classList.contains('active')) {
      chrome.storage.sync.get('geminiApiKey', function(data) {
        if (data.geminiApiKey) {
          apiKeyInput.value = data.geminiApiKey;
          apiKeyStatus.textContent = "API key is set";
          apiKeyStatus.style.color = "#4CAF50";
        } else {
          apiKeyInput.value = "";
          apiKeyStatus.textContent = "No API key set (using default)";
          apiKeyStatus.style.color = "#FFC107";
        }
      });
    }
  });
  
  // Save API key
  saveApiKeyBtn.addEventListener('click', function() {
    const apiKey = apiKeyInput.value.trim();
    
    if (apiKey === "") {
      // If empty, remove the stored key (will use default)
      chrome.storage.sync.remove('geminiApiKey', function() {
        apiKeyStatus.textContent = "API key removed, using default";
        apiKeyStatus.style.color = "#FFC107";
      });
    } else {
      // Save the API key
      chrome.storage.sync.set({geminiApiKey: apiKey}, function() {
        apiKeyStatus.textContent = "API key saved successfully";
        apiKeyStatus.style.color = "#4CAF50";
        
        // Clear after 3 seconds
        setTimeout(() => {
          apiKeyStatus.textContent = "API key is set";
        }, 3000);
      });
    }
  });
  
  // Display an error message in the popup
  function showError(message) {
    statusText.textContent = message || "Error occurred";
    statusIndicator.style.backgroundColor = "#F44336";
  }
  
  // Check the current site's enabled state when popup opens
  function checkSiteEnabledState() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (!tabs || tabs.length === 0) return;
      
      const url = new URL(tabs[0].url);
      const hostname = url.hostname;
      
      // Get the disabled sites from storage
      chrome.storage.sync.get('disabledSites', function(data) {
        const disabledSites = data.disabledSites || [];
        const isEnabled = !disabledSites.includes(hostname);
        
        // Update toggle state
        enableToggle.checked = isEnabled;
        updateToggleStatus(isEnabled);
      });
    });
  }

  // Update toggle text based on state
  function updateToggleStatus(isEnabled) {
    toggleStatus.textContent = isEnabled ? 'Enabled for this site' : 'Disabled for this site';
  }

  // Handle toggle change
  enableToggle.addEventListener('change', function() {
    const isEnabled = this.checked;
    updateToggleStatus(isEnabled);
    
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (!tabs || tabs.length === 0) return;
      
      const url = new URL(tabs[0].url);
      const hostname = url.hostname;
      
      // Get the current disabled sites
      chrome.storage.sync.get('disabledSites', function(data) {
        let disabledSites = data.disabledSites || [];
        
        if (isEnabled) {
          // Remove from disabled sites
          disabledSites = disabledSites.filter(site => site !== hostname);
        } else {
          // Add to disabled sites if not already present
          if (!disabledSites.includes(hostname)) {
            disabledSites.push(hostname);
          }
        }
        
        // Save back to storage
        chrome.storage.sync.set({disabledSites: disabledSites}, function() {
          console.log(`Site ${hostname} is now ${isEnabled ? 'enabled' : 'disabled'}`);
          
          // Send message to refresh content script
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "updateEnabledState", 
            isEnabled: isEnabled
          });
        });
      });
    });
  });
  
  // Check if current page has already been analyzed
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (!tabs || tabs.length === 0) {
      showError("No active tab found");
      return;
    }
    
    // Check site enabled state first
    checkSiteEnabledState();
    
    chrome.tabs.sendMessage(tabs[0].id, {action: "getAnalysisStatus"}, function(response) {
      if (chrome.runtime.lastError) {
        console.warn("Error getting analysis status:", chrome.runtime.lastError.message);
        return;
      }
      
      if (response && response.analyzed) {
        updateStatus(response.safetyScore);
      }
    });
  });
  
  // Analyze button click handler
  analyzeBtn.addEventListener('click', function() {
    // First check if API key is set
    chrome.storage.sync.get('geminiApiKey', function(data) {
      if (!data.geminiApiKey) {
        // If no custom API key, check if default should be used
        const useDefault = confirm("No custom API key set. Continue with default key?");
        if (!useDefault) {
          // Open settings panel if user wants to set their own key
          settingsPanel.classList.add('active');
          return;
        }
      }
      
      statusText.textContent = "Analyzing...";
      scoreContainer.style.display = "none"; // Hide previous results
      
      // Continue with analysis...
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs || tabs.length === 0) {
          showError("No active tab found");
          return;
        }
        
        console.log("Sending analyzePageContent message to tab:", tabs[0].id);
        
        // Send message to initiate analysis
        chrome.tabs.sendMessage(tabs[0].id, {action: "analyzePageContent"}, function(response) {
          if (chrome.runtime.lastError) {
            console.error("Error analyzing page:", chrome.runtime.lastError.message);
            showError("Failed to analyze page");
            return;
          }
          
          console.log("Received response from content script:", response);
          
          if (response && response.success) {
            statusText.textContent = "Analysis in progress...";
            
            // Poll for results after a delay
            setTimeout(function checkAnalysisStatus() {
              chrome.tabs.sendMessage(tabs[0].id, {action: "getAnalysisStatus"}, function(statusResponse) {
                if (chrome.runtime.lastError) {
                  console.warn("Error checking status:", chrome.runtime.lastError.message);
                  return;
                }
                
                if (statusResponse && statusResponse.analyzed) {
                  // Analysis completed, update UI
                  updateStatus(statusResponse.safetyScore);
                } else {
                  // Still analyzing, check again after a delay
                  setTimeout(checkAnalysisStatus, 1000);
                }
              });
            }, 1500);
          } else {
            showError("Analysis failed");
          }
        });
      });
    });
  });
  
  // View report button click handler
  viewReportBtn.addEventListener('click', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (!tabs || tabs.length === 0) {
        showError("No active tab found");
        return;
      }
      
      chrome.tabs.sendMessage(tabs[0].id, {action: "showDetailedAnalysis"}, function(response) {
        if (chrome.runtime.lastError) {
          console.error("Error showing report:", chrome.runtime.lastError.message);
        }
      });
    });
  });
  
  // Export button click handler
  exportBtn.addEventListener('click', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (!tabs || tabs.length === 0) {
        showError("No active tab found");
        return;
      }
      
      chrome.tabs.sendMessage(tabs[0].id, {action: "exportEvidence"}, function(response) {
        if (chrome.runtime.lastError) {
          console.error("Error exporting evidence:", chrome.runtime.lastError.message);
        }
      });
    });
  });
  
  // Update status display
  function updateStatus(safetyScore) {
    if (!safetyScore) {
      statusText.textContent = "Not analyzed";
      statusIndicator.style.backgroundColor = "";
      statusIndicator.className = "status-indicator";
      scoreContainer.style.display = "none";
      return;
    }
    
    scoreContainer.style.display = "block";
    scoreElement.textContent = safetyScore;
    
    let statusClass, statusDescription;
    
    if (safetyScore >= 80) {
      statusClass = "safe";
      statusDescription = "Safe";
    } else if (safetyScore >= 60) {
      statusClass = "moderate";
      statusDescription = "Moderate";
    } else {
      statusClass = "unsafe";
      statusDescription = "Potentially Unsafe";
    }
    
    // Update status indicator and text
    statusIndicator.className = "status-indicator " + statusClass;
    statusIndicator.style.backgroundColor = ""; // Let CSS handle colors
    statusText.textContent = statusDescription;
    
    // Update score color
    scoreElement.className = "score " + statusClass;
  }
});
