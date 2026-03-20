// IMPORTS
import axios from 'axios';
import fs from 'fs';

// CONSTANTS
const REDDIT_BASE_URL = 'https://www.reddit.com';
const REDDIT_SUBS = [
    'AmItheAsshole',
    'relationship_advice',
    'TrueOffMyChest',
    'confessions',
    'TIFU',
    'EntitledParents',
    'ChoosingBeggars',
    'antiwork',
    'MaliciousCompliance',
];
const ROOT_ASSETS_PATH = './assets';
const CONTENT_PATH = 'content.json';
const RUN_TIMESTAMP = Date.now();

// TYPES
interface RawContent {
    subreddit: string;
    title: string;
    content: string;
    author: string;
    url: string;
    score: string;
}
interface Sentence {
    id: number;
    text: string;
}

async function getRawContent(subs: string[]): Promise<RawContent> {
    if (!subs.length) {
        throw new Error('Subreddit list is empty');
    }

    const dirPath = `${ROOT_ASSETS_PATH}/rawContent`;

    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }

    try {
        // Fetch 5 posts per subreddit in parallel
        const responses = await Promise.all(
            subs.map((sub) =>
                axios.get(`${REDDIT_BASE_URL}/r/${sub}/top.json`, {
                    params: { limit: 10, t: 'day' },
                    headers: {
                        'User-Agent': 'MyRedditApp/1.0',
                    },
                }),
            ),
        );

        // Flatten all posts
        const allPosts = responses.flatMap(
            (res) => res?.data?.data?.children?.map((c: any) => c.data) || [],
        );

        fs.writeFileSync(`${dirPath}/allPosts.json`, JSON.stringify(allPosts, null, 2), 'utf-8');

        // Filter good content
        const filteredPosts = allPosts.filter((post) => {
            return (
                post.selftext &&
                post.selftext.length >= 500 &&
                // !post.over_18 &&
                !post.stickied
            );
        });

        fs.writeFileSync(
            `${dirPath}/filteredPosts.json`,
            JSON.stringify(filteredPosts, null, 2),
            'utf-8',
        );

        if (!filteredPosts.length) {
            throw new Error('No suitable posts found');
        }

        // Sort by score (descending)
        filteredPosts.sort((a, b) => b.score - a.score);
        fs.writeFileSync(
            `${dirPath}/sortedFilteredPosts.json`,
            JSON.stringify(filteredPosts, null, 2),
            'utf-8',
        );

        // Pick from top 3 randomly (adds variety)
        const topN = filteredPosts.slice(0, 3);
        fs.writeFileSync(`${dirPath}/topN.json`, JSON.stringify(topN, null, 2), 'utf-8');
        const bestPost = topN[Math.floor(Math.random() * topN.length)];

        fs.writeFileSync(`${dirPath}/bestPost.json`, JSON.stringify(bestPost, null, 2), 'utf-8');
        return {
            subreddit: bestPost.subreddit_name_prefixed,
            title: bestPost.title,
            content: bestPost.selftext,
            author: bestPost.author,
            url: REDDIT_BASE_URL + bestPost.permalink,
            score: bestPost.score,
        };
    } catch (err: any) {
        console.error('Reddit fetch error:', err.message);
        throw err;
    }
}

function sanitizeRawContent(rawContent: RawContent): RawContent {
    function sanitizeContent(content: string): string {
        if (!content) return '';

        return (
            content
                // --- REMOVE CODE ---
                .replace(/```[\s\S]*?```/g, '')
                .replace(/`[^`]*`/g, '')

                // --- LINKS ---
                .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
                .replace(/https?:\/\/[^\s)]+/g, 'a link')

                // --- REDDIT TERMS ---
                .replace(/\br\/([a-zA-Z0-9_]+)/g, 'subreddit $1')
                .replace(/\bu\/([a-zA-Z0-9_]+)/g, 'user $1')

                // --- QUOTES ---
                .replace(/^>\s?(.*)/gm, 'Someone said, $1.')

                // --- LISTS ---
                .replace(/^\s*[-*]\s+(.*)/gm, 'Next, $1.')

                // --- HEADINGS ---
                .replace(/^#{1,6}\s*(.*)/gm, '$1.')

                // --- EMPHASIS ---
                .replace(/[*_~]+/g, '')

                // --- ABBREVIATIONS ---
                .replace(/\bIMO\b/gi, 'in my opinion')
                .replace(/\bTLDR\b/gi, 'Too long, did not read')
                .replace(/\bOP\b/g, 'original poster')

                // --- SAFE SYMBOL CLEANUP ---
                .replace(/[^\w\s.,!?'"():;%$+\-/&]/g, '')

                // --- NORMALIZE SPACING ---
                .replace(/\s+/g, ' ')

                // --- SENTENCE BREAKS (FOR TTS) ---
                .replace(/([.!?])\s*/g, '$1\n')

                // --- CLEAN NEWLINES ---
                .replace(/\n{2,}/g, '\n')
                .trim()
        );
    }

    function sanitizeTitle(title: string): string {
        if (!title) return '';

        return title
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
            .replace(/\br\/([a-zA-Z0-9_]+)/g, 'subreddit $1')
            .replace(/\bu\/([a-zA-Z0-9_]+)/g, 'user $1')
            .replace(/[*_~]+/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    return {
        content: sanitizeContent(rawContent.content),
        title: sanitizeTitle(rawContent.title),
        subreddit: rawContent.subreddit,
        author: rawContent.author,
        url: rawContent.url,
        score: rawContent.score,
    };
}

function generateSentencesFromContent(sanitizedContent: RawContent): Sentence[] {
    const title = sanitizedContent.title;

    const credits = `Posted by u/${sanitizedContent.author} on ${sanitizedContent.subreddit}.`;

    const sentences = sanitizedContent.content
        .replace(/([.!?])(?=[A-Z])/g, '$1\n')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

    const all = [title, credits, ...sentences];

    return all.map((text, i) => ({
        id: i,
        text,
    }));
}

async function main() {
    const dirPath = `${ROOT_ASSETS_PATH}/${RUN_TIMESTAMP}`;
    const contentPath = `${dirPath}/${CONTENT_PATH}`;

    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }

    // Get content
    const rawContent = await getRawContent(REDDIT_SUBS);
    fs.writeFileSync(contentPath, JSON.stringify({ rawContent }, null, 2), 'utf-8');
    const sanitizedContent = sanitizeRawContent(rawContent);
    fs.writeFileSync(
        contentPath,
        JSON.stringify({ rawContent, sanitizedContent }, null, 2),
        'utf-8',
    );
    const sentences = generateSentencesFromContent(sanitizedContent);
    fs.writeFileSync(
        contentPath,
        JSON.stringify({ rawContent, sanitizedContent, sentences }, null, 2),
        'utf-8',
    );
}

main();
