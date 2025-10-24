const Apify = require('apify');
const fetch = require('node-fetch');

Apify.main(async () => {
    // Charger l'input depuis Input Schema
    const input = await Apify.getInput();
    const profiles = input.profiles || [];
    const emailProvider = input.emailProvider || 'none';
    const verifyEmails = input.verifyEmails || false;
    const maxConcurrency = input.maxConcurrency || 2;

    if (!profiles.length) {
        throw new Error('Aucune URL de profil fournie dans l’input.');
    }

    console.log(`Nombre de profils à traiter : ${profiles.length}`);

    const results = [];

    // Puppeteer Crawler
    const crawler = new Apify.PuppeteerCrawler({
        maxConcurrency,
        launchPuppeteerOptions: { headless: true, stealth: true },
        handlePageFunction: async ({ page, request }) => {
            const url = request.url;
            console.log(`Visiting: ${url}`);

            // Attendre 1s pour que le rendu JS se fasse
            await page.waitForTimeout(1000);

            // Extraction du profil (Twitter / LinkedIn)
            const profileData = await page.evaluate(() => {
                const text = (sel) => {
                    const el = document.querySelector(sel);
                    return el ? el.innerText.trim() : null;
                };
                const link = (sel) => {
                    const el = document.querySelector(sel);
                    return el ? el.href : null;
                };

                let name = text('div[data-testid="UserName"] span') || text('.text-heading-xlarge');
                let bio = text('div[data-testid="UserDescription"]') || text('.pv-about__summary-text');
                let website = link('a[href^="http"]:not([href*="linkedin.com"])') || null;

                return { name, bio, website };
            });

            profileData.profileUrl = url;

            // Extraction d’emails depuis la bio ou le site
            const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
            let foundEmails = [];

            if (profileData.bio) {
                const emailsInBio = profileData.bio.match(emailRegex);
                if (emailsInBio) foundEmails.push(...emailsInBio);
            }

            if (profileData.website) {
                try {
                    const resp = await fetch(profileData.website);
                    const html = await resp.text();
                    const emailsInSite = html.match(emailRegex);
                    if (emailsInSite) foundEmails.push(...emailsInSite);
                } catch (e) {
                    console.warn(`Erreur fetch site ${profileData.website}: ${e.message}`);
                }
            }

            // Supprimer doublons et normaliser
            foundEmails = [...new Set(foundEmails.map(e => e.toLowerCase()))];

            profileData.foundEmails = foundEmails;

            results.push(profileData);
            await Apify.pushData(profileData);
        },

        handleFailedRequestFunction: async ({ request }) => {
            console.log(`Request failed: ${request.url}`);
            await Apify.pushData({ url: request.url, error: 'failed' });
        }
    });

    // Ajouter chaque profil à la queue
    for (const profileUrl of profiles) {
        await crawler.addRequests([{ url: profileUrl }]);
    }

    await crawler.run();

    console.log('Scraping terminé. Résultats:');
    console.log(results);
});
