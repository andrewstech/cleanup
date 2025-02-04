const axios = require("axios");
const { Octokit } = require("@octokit/rest");

const githubUsername = "GITHUB_USERNAME";
const githubToken = "GITHUB_PAT_TOKEN";
const apiUrl = "https://raw-api.is-a.dev/";

let amountScanned = 0;
const domainsToSkip = ["@"];

async function fetchData() {
    try {
        const response = await axios.get(apiUrl);
        let data = response.data;

        amountScanned = data.length;

        const invalidDomains = [];
        const invalidDomainData = [];

        for (const entry of data) {
            const domain = entry.domain;
            const domainUrl = `https://${domain}`;

            // Skip if the domain is not pointing to a valid IP address
            if (!entry.record.A && !entry.record.AAAA && !entry.record.CNAME && !entry.record.URL) continue;
            // Skip if the domain is in the skip list
            if (domainsToSkip.includes(entry.subdomain)) continue;

            try {
                await axios.head(domainUrl);
            } catch (error) {
                // Skip if the domain's SSL certificate is invalid
                if (error.code === "ERR_TLS_CERT_ALTNAME_INVALID") continue;

                console.error(`[ERROR] ${domain}: ${error.message}`);

                invalidDomains.push(entry.subdomain);
                invalidDomainData.push(entry);
            }
        }

        if (invalidDomains.length > 0) {
            await forkAndOpenPR(invalidDomains, invalidDomainData);
        } else {
            console.log("No invalid domains found.");
        }
    } catch (error) {
        console.error(`[ERROR] Fetching data: ${error.message}`);
    }
}

async function forkAndOpenPR(invalidDomains, invalidDomainData) {
    const octokit = new Octokit({ auth: githubToken });

    try {
        // Fork the repository
        const forkResponse = await octokit.repos.createFork({
            owner: "is-a-dev",
            repo: "register",
        });

        const forkedRepoFullName = forkResponse.data.full_name;

        // Make changes in the forked repository
        await deleteInvalidFiles(invalidDomains, forkedRepoFullName);

        // Open a pull request
        const prResponse = await octokit.pulls.create({
            owner: "is-a-dev",
            repo: "register",
            title: "[no-rm] remove unresolvable domains",
            body: `Scanned **${amountScanned}** domain${amountScanned === 1 ? "" : "s"} and found **${invalidDomains.length}** unresolvable domain${invalidDomains.length === 1 ? "" : "s"}.

<details>
<summary>Domain Owners</summary>

${invalidDomainData.map((e) => `@${e.owner.username}: ${e.domain}(https://${e.domain})`).join("\n")}

</details>
`,
            head: `${githubUsername}:main`,
            base: "main",
        });

        console.log(`Pull request opened: ${prResponse.data.html_url}`);
    } catch (error) {
        console.error(`[ERROR] Forking repository or opening PR: ${error.message}`);
    }
}

async function deleteInvalidFiles(invalidDomains, repoFullName) {
    const octokit = new Octokit({ auth: githubToken });

    for (const domain of invalidDomains) {
        const fileName = `domains/${domain}.json`;

        try {
            const fileContent = await octokit.repos.getContent({
                owner: "is-a-dev",
                repo: "register",
                path: fileName,
            });

            const sha = fileContent.data.sha;

            await octokit.repos.deleteFile({
                owner: repoFullName.split("/")[0],
                repo: repoFullName.split("/")[1],
                path: fileName,
                message: `chore: remove ${domain}.is-a.dev`,
                sha: sha,
            });

            console.log(`Deleted ${domain}.is-a.dev`);
        } catch (error) {
            console.error(`[ERROR] Deleting ${domain}: ${error.message}`);
        }
    }
}

fetchData();
