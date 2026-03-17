export { escapeHTML, parseMarkdown, checkPermissions, getImage, getPfp, replaceShortcodes, notif, checkPermissionCustom };
import { userData, currentPermissions, shortCodes, messageArea, channels, userList, roles } from "./main.js";

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function notif(content, icon) {
    const div = document.createElement("div");
    div.classList.add("notificationDiv", "notificationFade");
    const icn = document.createElement("img");
    icn.src = "data:image/svg+xml," + encodeURIComponent(icon);
    const p = document.createElement("p");
    p.textContent = content;
    p.classList.add("notificationText");
    div.append(icn, p);
    messageArea.append(div);
    requestAnimationFrame(() => div.classList.remove("notificationFade"));
    setTimeout(() => {
        div.classList.add("notificationFade");
        setTimeout(() => div.remove(), 1000);
    }, 3000)
}

function parseMarkdown(text) {
    const lines = text.split("\n");
    const returned = [];
    let inCodeBlock = false;
    let codeLanguage = '';
    let codeBuffer = [];

    for (let unsafeText of lines) {

        unsafeText = unsafeText.replace(/@&([\w-]+)/g, (m, role) => {
            if (roles[role])
                return `%%ROLE%%${role}%%`;
            return m;
        });

        let line = escapeHTML(unsafeText);

        const codeBlockMatch = line.match(/^```(\w*)$/);
        if (codeBlockMatch) {
            if (inCodeBlock) {
                returned.push(
                    `<pre><code class="language-${codeLanguage}">` +
                    codeBuffer.join("\n") +
                    `</code></pre>`
                );
                inCodeBlock = false;
                codeLanguage = '';
                codeBuffer = [];
            } else {
                inCodeBlock = true;
                codeLanguage = codeBlockMatch[1] || '';
                codeBuffer = [];
            }
            continue;
        }

        if (inCodeBlock) {
            codeBuffer.push(line);
            continue;
        }

        line = line.replace(/^(#{1,6})\s+(.*)$/gm, (m, hashes, content) => {
            const level = hashes.length;
            return `<h${level}>${content}</h${level}>`;
        });

        line = line.replace(/\*\*(.+?)\*\*/g, `<span style="font-weight: bold;">$1</span>`);

        line = line.replace(/\|\|(.+?)\|\|/g, `<label class="spoilerText"><input type="checkbox" onclick="this.disabled = true"><span>$1</span></label>`);

        line = line.replace(/`(.+?)`/g, `<code class="inlineCode">$1</code>`);
        line = line.replace(/^-#\s*(.+)$/gm, `<h6 class="smallText">$1</h6>`);

        line = line.replace(/_(.+?)_/g, `<span style="font-style: italic;">$1</span>`);

        line = line.replace(/(?<!<)https?:\/\/[^\s<]+/g, url => {
            return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="link">${url}</a>`;
        });

        line = line.replace(/@([\w-]+)/g, (m, username) => {
            const vU = userList.find(u => line.includes(u?.username));
            if (vU)
                return `<span class="mention" onclick="previewProfile('${username}')">@${username}</span>`;
            return m;
        });

        line = line.replace(/#\$([\w-]+)/g, (m, id) => {
            return `<span class="mention" onclick="jumpToMsg('${id}')">${id}</span>`;
        });

        line = line.replace(/#([\w-]+)/g, (m, channel) => {
            const vC = channels.find(c => c?.name === channel);
            if (vC) 
                return `<span class="mention" onclick="openChannel('#${channel}', '${channel}')">#${channel}</span>`;
            
            return m;
            
        });

        line = line.replace(/originChats:\/\/([\w.-]+)\/([\w-]+)/g, (m, server, channel) => {
            const vC = channels.find(c => c?.name === channel);
            if (vC)
                return `<span class="mention" onclick="openChannel('#${channel}', '${channel}', {}, '${server}')">#${channel}</span>`;
            
            return m;
        });

        line = line.replace(/%%ROLE%%([\w-]+)%%/g,
            `<span class="mention role-$1">@$1</span>`
        );

        returned.push(line);
    }

    if (inCodeBlock) {
        returned.push(
            `<pre><code class="language-${codeLanguage}">` +
            codeBuffer.join("\n") +
            `</code></pre>`
        );
    }

    const parsed = returned.join("\n");

    return DOMPurify.sanitize(parsed, {
        ALLOWED_TAGS: [
            "h1","h2","h3","h4","h5","h6",
            "span","pre","code","a","label","input"
        ],
        ALLOWED_ATTR: [
            "style",
            "onclick",
            "class",
            "href",
            "target",
            "rel",
            "type"
        ]
    });
}

function checkPermissions(type) {
    for (const role of userData.roles) {
        if (currentPermissions?.[type]?.includes(role)) return true;
    }
    return false;
}

function checkPermissionCustom(perms) {
    for (const role of userData.roles) {
        if (perms?.includes(role)) return true;
    }
    return false;
}

let imageCache = {};

async function getImage(url) {
    let d = imageCache[url]
    if (d) return d;
    const res = await fetch(url);
    
    d = URL.createObjectURL(await res.blob());
    imageCache[url] = d;
    return d;
}

let userPfps = {};

async function getPfp(username) {
    if (userPfps[username]) {
        while (userPfps[username] === "pending") {
            await new Promise((r) => setTimeout(r, 10));
        }
        return userPfps[username];
    }

    userPfps[username] = "pending";

    const res = await fetch(`https://avatars.rotur.dev/${username}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    userPfps[username] = url;
    return url;
}

function replaceShortcodes(input) {
    if (!shortCodes) {
        console.warn("Emoji mappings not loaded yet!");
        return input;
    }

    return input.replace(/:[a-zA-Z0-9_+-]+:/g, (match) => {
        return shortCodes[match] || match;
    });
}