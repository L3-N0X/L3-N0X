import fs from 'node:fs';
import path from 'node:path';

const USERNAME = process.env.GH_USERNAME || 'L3-N0X';
const TOKEN = process.env.GH_STATS_TOKEN || process.env.GITHUB_TOKEN;

if (!TOKEN) {
  console.error('Missing GH_STATS_TOKEN or GITHUB_TOKEN environment variable.');
  process.exit(1);
}

// Exclude university coursework/docs/dotfiles that skew raw byte counts
const EXCLUDED_REPOS = new Set([
  `${USERNAME}/programmieren-1`,
  `${USERNAME}/programmieren-2`,
  `${USERNAME}/algorithmen-datenstrukturen`,
  `${USERNAME}/software-engineering-project-ss26`,
  `${USERNAME}/docs`,
  `${USERNAME}/dotfiles`,
  `${USERNAME}/java-karol`,
]);

const QUERY = `
query($login: String!) {
  user(login: $login) {
    repositories(first: 100, ownerAffiliations: [OWNER, ORGANIZATION_MEMBER, COLLABORATOR], isFork: false) {
      nodes {
        nameWithOwner
        isPrivate
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
          edges {
            size
            node {
              name
            }
          }
        }
      }
    }
  }
  eatme: repository(owner: "EatMe-App", name: "EatMe") {
    nameWithOwner
    isPrivate
    languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
      edges {
        size
        node {
          name
        }
      }
    }
  }
  goatty: repository(owner: "goatty-dev", name: "goatty") {
    nameWithOwner
    isPrivate
    languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
      edges {
        size
        node {
          name
        }
      }
    }
  }
}
`;

async function fetchRepos() {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'L3-N0X-profile-stats',
    },
    body: JSON.stringify({ query: QUERY, variables: { login: USERNAME } }),
  });

  if (!res.ok) {
    throw new Error(`GitHub GraphQL error: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  if (!json.data?.user?.repositories) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  // Deduplicate repos (eatme / goatty may be omitted if token lacks private org scope)
  const byName = new Map();
  for (const r of json.data.user.repositories.nodes || []) {
    if (r?.nameWithOwner) byName.set(r.nameWithOwner, r);
  }
  for (const extra of [json.data.eatme, json.data.goatty]) {
    if (extra?.nameWithOwner) byName.set(extra.nameWithOwner, extra);
  }
  return [...byName.values()];
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderLanguagesSvg(repos) {
  const totals = new Map();
  let repoCount = 0;
  let privateCount = 0;

  for (const repo of repos) {
    if (EXCLUDED_REPOS.has(repo.nameWithOwner)) continue;
    const edges = repo.languages?.edges || [];
    if (edges.length === 0) continue;
    repoCount++;
    if (repo.isPrivate) privateCount++;
    for (const edge of edges) {
      const name = edge.node.name;
      totals.set(name, (totals.get(name) || 0) + edge.size);
    }
  }

  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const totalBytes = sorted.reduce((acc, [, size]) => acc + size, 0) || 1;
  const top6 = sorted.slice(0, 6);
  const top6Bytes = top6.reduce((acc, [, size]) => acc + size, 0);
  const otherBytes = Math.max(0, totalBytes - top6Bytes);

  const items = top6.map(([name, size]) => ({
    name,
    pct: (size / totalBytes) * 100,
  }));

  if (otherBytes > 0 && (otherBytes / totalBytes) * 100 >= 0.5) {
    items.push({
      name: 'Other',
      pct: (otherBytes / totalBytes) * 100,
    });
  }

  const palette = [
    '#a5d8ff',
    '#79b8ff',
    '#4b82b8',
    '#34608c',
    '#7c8ea3',
    '#526375',
    '#323d4a',
  ];

  const width = 900;
  const height = 176;
  const padX = 44;
  const barX = padX;
  const barY = 66;
  const barW = width - padX * 2;
  const barH = 10;
  const gap = 3;

  const totalGap = gap * Math.max(0, items.length - 1);
  const usableW = barW - totalGap;
  let curX = barX;

  const segments = items.map((item, idx) => {
    const segW = idx === items.length - 1
      ? Math.max(4, barX + barW - curX)
      : Math.max(4, Math.round((item.pct / 100) * usableW));
    const color = palette[idx % palette.length];
    const x = curX;
    curX += segW + gap;
    return `<rect x="${x}" y="${barY}" width="${segW}" height="${barH}" rx="2" fill="${color}" />`;
  }).join('\n    ');

  const cols = 4;
  const colGap = 28;
  const colW = (barW - colGap * (cols - 1)) / cols;
  const legendStartY = 104;
  const rowH = 26;

  const legendItems = items.map((item, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = padX + col * (colW + colGap);
    const y = legendStartY + row * rowH;
    const color = palette[idx % palette.length];
    const pctStr = `${item.pct.toFixed(1)}%`;
    const label = item.name === 'Jupyter Notebook' ? 'Jupyter' : item.name;

    return `
    <g transform="translate(${x.toFixed(1)}, ${y})">
      <rect x="0" y="3" width="8" height="8" rx="2" fill="${color}" />
      <text x="16" y="11" fill="#e6edf3" font-size="12.5" font-weight="500">${escapeXml(label)}</text>
      <text x="${colW.toFixed(1)}" y="11" text-anchor="end" fill="#8b949e" font-size="12">${pctStr}</text>
    </g>`;
  }).join('');

  const subtitle = privateCount > 0
    ? `${repoCount} repositories (public & private)`
    : `${repoCount} public repositories`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">
  <style>
    text { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
  </style>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="#0b0f16" stroke="#1e2633" />
  <text x="${padX}" y="38" fill="#8b949e" font-size="12" letter-spacing="1.8">LANGUAGES</text>
  <text x="${width - padX}" y="38" text-anchor="end" fill="#6e7681" font-size="11.5">${escapeXml(subtitle)}</text>
  <g>
    ${segments}
  </g>
  ${legendItems}
</svg>
`;
}

async function main() {
  const repos = await fetchRepos();
  const outDir = path.resolve(process.cwd(), 'assets');
  fs.mkdirSync(outDir, { recursive: true });

  const langSvg = renderLanguagesSvg(repos);
  fs.writeFileSync(path.join(outDir, 'languages.svg'), langSvg, 'utf8');
  console.log(`Generated assets/languages.svg from ${repos.length} total fetched repositories`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
