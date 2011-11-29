/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

let newTabOne;
let newTabTwo;
let newTabThree;
let restoredNewTabTwoLoaded = false;
let restoredNewTabThreeLoaded = false;
let frameInitialized = false;

function test() {
  waitForExplicitFinish();
  newWindowWithTabView(setupOne);
}

function setupOne(win) {
  win.TabView.firstUseExperienced = true;

  win.gBrowser.addTab("http://mochi.test:8888/browser/browser/components/tabview/test/search1.html");
  win.gBrowser.addTab("http://mochi.test:8888/browser/browser/components/tabview/test/dummy_page.html");

  afterAllTabsLoaded(function () setupTwo(win), win);
}

let restoredWin;

function setupTwo(win) {
  let contentWindow = win.TabView.getContentWindow();

  let tabItems = contentWindow.TabItems.getItems();
  is(tabItems.length, 3, "There should be 3 tab items before closing");

  let numTabsToSave = tabItems.length;

  // force all canvases to update, and hook in imageData save detection
  tabItems.forEach(function(tabItem) {
    // mark thumbnail as dirty
    tabItem.tabCanvas.paint();

    tabItem.addSubscriber("savedCachedImageData", function onSaved(item) {
      item.removeSubscriber("savedCachedImageData", onSaved);

      if (!--numTabsToSave)
        restoreWindow();
    });
  });

  // after the window is closed, restore it.
  let restoreWindow = function() {
    executeSoon(function() {
      restoredWin = undoCloseWindow();
      restoredWin.addEventListener("load", function onLoad(event) {
        restoredWin.removeEventListener("load", onLoad, false);

        registerCleanupFunction(function() restoredWin.close());
        is(restoredWin.gBrowser.tabs.length, 3, "The total number of tabs is 3");

        // setup tab variables and listen to the tabs load progress
        newTabOne = restoredWin.gBrowser.tabs[0];
        newTabTwo = restoredWin.gBrowser.tabs[1];
        newTabThree = restoredWin.gBrowser.tabs[2];
        restoredWin.gBrowser.addTabsProgressListener(gTabsProgressListener);

        // execute code when the frame is initialized
        let onTabViewFrameInitialized = function() {
          restoredWin.removeEventListener(
            "tabviewframeinitialized", onTabViewFrameInitialized, false);

          let restoredContentWindow = restoredWin.TabView.getContentWindow();
          // prevent thumbnails from being updated before checking cached images
          restoredContentWindow.TabItems.pausePainting();

          let nextStep = function() {
            // since we are not sure whether the frame is initialized first or two tabs
            // compete loading first so we need this.
            if (restoredNewTabTwoLoaded && restoredNewTabThreeLoaded)
              updateAndCheck();
            else
              frameInitialized = true;
          }

          let tabItems = restoredContentWindow.TabItems.getItems();
          let count = tabItems.length;

          tabItems.forEach(function(tabItem) {
            tabItem.addSubscriber("showingCachedData", function onLoaded() {
              tabItem.removeSubscriber("showingCachedData", onLoaded);
              ok(tabItem.isShowingCachedData(),
                "Tab item is showing cached data and is just connected. " +
                tabItem.tab.linkedBrowser.currentURI.spec);
              if (--count == 0)
                nextStep();
            });
          });
        }

        restoredWin.addEventListener(
          "tabviewframeinitialized", onTabViewFrameInitialized, false);
      }, false);
    });
  };

  win.close();
}

let gTabsProgressListener = {
  onStateChange: function(browser, webProgress, request, stateFlags, status) {
    // ensure about:blank doesn't trigger the code
    if ((stateFlags & Ci.nsIWebProgressListener.STATE_STOP) &&
        (stateFlags & Ci.nsIWebProgressListener.STATE_IS_WINDOW) &&
         browser.currentURI.spec != "about:blank") {
      if (newTabTwo.linkedBrowser == browser)
        restoredNewTabTwoLoaded = true;
      else if (newTabThree.linkedBrowser == browser)
        restoredNewTabThreeLoaded = true;

      // since we are not sure whether the frame is initialized first or two tabs
      // compete loading first so we need this.
      if (restoredNewTabTwoLoaded && restoredNewTabThreeLoaded) {
        restoredWin.gBrowser.removeTabsProgressListener(gTabsProgressListener);

        if (frameInitialized)
          updateAndCheck();
      }
    }
  }
};

function updateAndCheck() {
  // force all canvas to update
  let contentWindow = restoredWin.TabView.getContentWindow();

  contentWindow.TabItems.resumePainting();

  let tabItems = contentWindow.TabItems.getItems();
  tabItems.forEach(function(tabItem) {
    tabItem.addSubscriber("thumbnailUpdated", function onUpdated() {
      tabItem.removeSubscriber("thumbnailUpdated", onUpdated);
      ok(!tabItem.isShowingCachedData(),
         "Tab item is not showing cached data anymore. " +
         tabItem.tab.linkedBrowser.currentURI.spec);
    });
    contentWindow.TabItems.addToUpdateQueue(tabItem.tab);
  });

  // clean up and finish
  restoredWin.close();
  finish();
}
