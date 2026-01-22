# redditIQ

redditIQ is a lightweight browser extension for Chromium browsers (Chrome, Edge, Brave) that scores and tags Reddit posts for quality.

## Install (Chrome, Brave, Arc, etc)

1) Download the repo  
- Option A: Clone
```bash
git clone https://github.com/lor3nzo/redditIQ.git
cd redditIQ
```
- Option B: Download ZIP
  - Click the green **Code** button on GitHub
  - Choose **Download ZIP**
  - Unzip it somewhere permanent (your browser loads the extension from that folder)

2) Open the Extensions page  
- In Chrome: go to `chrome://extensions`  
- In Brave: go to `brave://extensions`  
- In Arc: go to `chrome://extensions`

3) Enable Developer mode  
- Toggle **Developer mode** on (top right)

4) Load the extension  
- Click **Load unpacked**  
- Select the project folder that contains `manifest.json`

5) Test it  
- Open `https://www.reddit.com`  
- Refresh the page  
- You should see redditIQ scores or tags appear on posts

## Install (Microsoft Edge)

1) Download the repo (clone or ZIP, same as above)

2) Open the Extensions page  
- Go to `edge://extensions`

3) Enable Developer mode  
- Toggle **Developer mode** on

4) Load the extension  
- Click **Load unpacked**  
- Select the project folder that contains `manifest.json`

5) Test it  
- Open `https://www.reddit.com`  
- Refresh the page

## Updating

- If you cloned the repo:
```bash
git pull
```

- After any update, go to your extensions page and click **Reload** on the redditIQ card, then refresh Reddit.

## Troubleshooting

- Extension loads but nothing changes on Reddit
  - Refresh the Reddit tab
  - Make sure the extension is enabled
  - On `chrome://extensions`, open **Details** for redditIQ and confirm it has access to `reddit.com`
  - Open **Inspect views** (service worker or popup) and check the Console for errors

## License

GPL-3.0. See `LICENSE`.
