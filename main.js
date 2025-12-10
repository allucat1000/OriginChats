import { parseMarkdown, checkPermissions, getImage, getPfp, replaceShortcodes, notif } from "./helpers.js";
import { openSettings, closeSettings, settingsOpen } from "./settings.js";

export { mainDiv, userData, shortCodes, currentPermissions, config, messageArea, channels, userList };

const mac = navigator.platform.toUpperCase().includes("MAC");
if (!mac) document.body.style.backgroundColor = "rgb(0, 0, 0, 0.3)";

const winClose = document.getElementById("winClose");
const title = document.getElementById("title");
winClose.onclick = () => {
    window.electronAPI.windowControl("close");
}

const mainDiv = document.getElementById("main");

mainDiv.style.display = "none";

let config = JSON.parse(localStorage.getItem("config") || "{}");
if (Object.keys(config).length === 0) {
    config = await (await fetch("./config.json")).json();
    localStorage.setItem("config", JSON.stringify(config));
}

let ws, token, valKey, serverInfo, auth, userData, channels, messages, lastUser, lastDate, url, profilePreviewDiv, previewBg, lastPing, currentChannel, openingPopup, currentPermissions, messageList;
const chatInput = document.getElementById("chatInput");
let ratelimit = {};
let messageScroll = 0;
let userColors = {};
let userList = [];

let pings = {};
let reactedMessages = {};
let messageStore = {};
let shortCodes;

try {
    const script = `
        (async () => {
            const [emojiData, shortcodes] = await Promise.all([
                fetch("https://cdn.jsdelivr.net/npm/emojibase-data/en/data.json").then(r => r.json()),
                fetch("https://cdn.jsdelivr.net/npm/emojibase-data/en/shortcodes/joypixels.json").then(r => r.json())
            ]);

            const shortcodeToEmoji = {};
            const emojiToShortcode = {};

            for (const emoji of emojiData) {
                const codes = shortcodes[emoji.hexcode];
                if (codes) {
                    (Array.isArray(codes) ? codes : [codes]).forEach(sc => {
                        shortcodeToEmoji[\`:\${sc}:\`] = emoji.emoji;
                    });
                    emojiToShortcode[emoji.emoji] = \`:\${Array.isArray(codes) ? codes[0] : codes}:\`;
                }
            }

            window.shortcodeToEmoji = shortcodeToEmoji;
            window.emojiToShortcode = emojiToShortcode;
        })();
    `;

    const blob = new Blob([script], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);

    const scriptEl = document.createElement("script");
    scriptEl.type = "module";
    scriptEl.src = url;
    document.head.append(scriptEl);

    scriptEl.onload = async () => {
        while (!window.shortcodeToEmoji) {
            await new Promise(r => setTimeout(r, 10));
        }
        shortCodes = window.shortcodeToEmoji;
    };
} catch (error) {
    console.error("Failed to load emoji shortcodes!", error.message)
}


async function previewProfile(name) {
    if (openingPopup == true) return;
    openingPopup = true;
    if (!name) {
        profilePreviewDiv.style.opacity = "0";
        setTimeout(() => {
            previewBg.remove();
            profilePreviewDiv = null;
            openingPopup = false;
            return;
        }, 500);
    } else {
        const res = await fetch(`https://api.rotur.dev/profile?name=${name}`);
        if (profilePreviewDiv) { profilePreviewDiv.style.opacity = "0"; setTimeout(() => { previewBg.remove(); profilePreviewDiv = null; openingPopup = false; return; }, 500) }
        if (res.ok) {
            const data = await res.json();
            profilePreviewDiv = document.createElement("div");
            profilePreviewDiv.classList.add("profilePreview");
            const pfp = document.createElement("img");
            const nameDiv = document.createElement("div");
            nameDiv.classList.add("profilePreviewNameDiv");
            const username = document.createElement("p");
            const bioText = document.createElement("p");
            const pronouns = document.createElement("p");
            pronouns.classList.add("profilePreviewPronouns");
            pronouns.textContent = data.pronouns;
            bioText.classList.add("profilePreviewBioTitle");
            bioText.textContent = "Bio";
            username.classList.add("profileUsername");
            pfp.classList.add("profilePfp");
            const bio = document.createElement("p");
            bio.classList.add("profileBio");
            const userDiv = document.createElement("div");
            const bioSplitter = document.createElement("div");
            bioSplitter.classList.add("borderSplitter");
            pfp.src = await getPfp(name);
            bio.textContent = data.bio;
            username.textContent = data.username;
            userDiv.classList.add("profileUserDiv");
            nameDiv.append(username, pronouns)
            userDiv.append(pfp, nameDiv);
            profilePreviewDiv.append(userDiv, bioSplitter, bioText, bio);
            previewBg = document.createElement("div");
            previewBg.classList.add("profileBg");
            previewBg.append(profilePreviewDiv);
            mainDiv.append(previewBg)
            setTimeout(() => { profilePreviewDiv.style.opacity = "1"; previewBg.onclick = () => previewProfile(); }, 10);
        } else {}
    }
    openingPopup = false;
}

window.previewProfile = previewProfile;



async function loadCss() {
    let theme = localStorage.getItem("theme");

    let customCss = localStorage.getItem("customCss");
    if (!theme) { localStorage.setItem("theme", "./styles.css"); theme = "./styles.css"; }
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = theme;

    const l2 = document.createElement("link");
    l2.rel = "stylesheet";
    l2.href = "data:text/css;base64," + encodeURIComponent(customCss);
    document.head.append(l, l2);
}



loadCss();

async function connect(url) {
    try {
        ws = new WebSocket(url);
    } catch {
        console.error("Unable to connect to server");
        localStorage.setItem("openServer", "wss://chats.mistium.com");
        setTimeout(() => window.location.reload(), 5000);
        return;
    }
    ws.onclose = () => disconnect();
    ws.onopen = () => initFuncs();
    return;
    
}

function disconnect() {
    const lT = document.querySelector("#connectionText");
    if (lT) lT.remove();
    mainDiv.innerHTML = "";
    mainDiv.style.display = "block";
    const error = document.createElement("h2");
    const errorIcon = document.createElement("div");
    const openServer = document.createElement("input");
    openServer.classList.add("connectErrorNewServer");
    openServer.placeholder = "Open another server";
    openServer.addEventListener("keydown", (e) => {
        if (e.key == "Enter") {
            if (openServer.value) {
                localStorage.setItem("openServer", openServer.value);
                window.location.reload();
            }
        }
    })
    errorIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-x-icon lucide-circle-x"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`;
    errorIcon.classList.add("connectErrorIcon")
    error.textContent = "Unable to connect to server. Retrying in 10 seconds...";
    error.classList.add("connectError");
    mainDiv.append(error, errorIcon, openServer);
    setTimeout(() => window.location.reload(), 10000);
}

const messageArea = document.getElementById("messages");

async function checkPing(msg) {
    if (!msg.channel) return;
    let readPings = localStorage.getItem("readPings") || "[]";
    try {
        readPings = JSON.parse(readPings);
    } catch {
        localStorage.setItem("readPings", "[]");
        readPings = [];
    }
    const mentionRegex = new RegExp(`@${userData.username}\\b`);
    if (mentionRegex.test(msg.content)) {
        if (!readPings.includes(msg.id)) {
            if (Date.now() - 2500 > (lastPing || 0)) {
                lastPing = Date.now();

                function playPing(frequency, duration = 0.2, volume = 0.2) {
                    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

                    const oscillator = audioCtx.createOscillator();
                    oscillator.type = "sine";
                    oscillator.frequency.value = frequency;

                    const gainNode = audioCtx.createGain();
                    gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);

                    oscillator.connect(gainNode);
                    gainNode.connect(audioCtx.destination);

                    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

                    oscillator.start(audioCtx.currentTime);
                    oscillator.stop(audioCtx.currentTime + duration);
                }

                playPing(400);
                setTimeout(() => playPing(600), 200)
            }
            readPings.push(msg.id);
            localStorage.setItem("readPings", JSON.stringify(readPings));
            if (msg.channel !== currentChannel) {
                let channelPings = pings[msg.channel];
                if (channelPings == undefined) channelPings = 0;
                pings[msg.channel] = ++channelPings;
                const channelDiv = channelSidebar.querySelector("#channel-" + msg.channel);
                if (channelDiv) channelDiv.textContent = "#" + msg.channel + ` (${channelPings})`;
            }
        }
        return true;
    }
    return false;
}

function unescapeHTML(h) {
    const p = document.createElement("p");
    p.innerHTML = h;
    return p.textContent;
}

let nextMessageCount = (() => {
    const items = [...document.querySelectorAll('[id^="message-"]')];
    const nums = items.map(i => {
        const m = i.id.match(/^message-(\d+)$/);
        return m ? Number(m[1]) : -1;
    });
    const max = nums.length ? Math.max(...nums) : -1;
    return max + 1;
})();

async function fetchS(url) {
    try {
        const p = config?.[0]?.Miscellaneous?.[0]?.state
        const r = await fetch(p ? p + encodeURIComponent(url) : url);
        if (!r.ok) return null;
        return await r.text();
    } catch {
        return null;
    }
}

async function detectType(url) {
    try {
        const res = await fetch(url, { method: "HEAD" });
        const type = res.headers.get("content-type");

        if (type && type.startsWith("image/")) return "image";
        if (type && type.startsWith("video/")) return "video";
        return "generic";
    } catch (e) {
        return "generic";
    }
}

async function detectProvider(url) {
    if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
    if (/twitter\.com/.test(url)) return "twitter";
    if (/twitch\.tv/.test(url)) return "twitch";

    return await detectType(url);
}

async function generateEmbed(url) {
    const o = new URL(url)?.origin?.replace("https", "http");
    const provider = await detectProvider(url);

    switch (provider) {

        case "youtube": {
            const id = url.match(/(?:v=|youtu\.be\/|shorts\/)([\w\-]+)/)?.[1];
            if (!id) break;

            const div = document.createElement("div");
            div.classList.add("embedVideoDiv");


            const img = document.createElement("img");
            img.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
            img.classList.add("embedVideoThumbnail");

            const el = document.createElement("iframe");
            el.classList.add("embedVideo")
            el.src = `https://yout-ube.com/watch?v=${id}`;
            el.allow = "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture";

            div.append(img);
            img.onclick = () => {
                img.remove();
                div.append(el);
            }

            return div;
        }

        case "image": {
            const el = document.createElement("img");
            el.className = "embedImage";

            el.src = await getImage(url);
            return el;
        }

        case "video": {
            const el = document.createElement("video");
            el.className = "embedVideo";
            el.src = url;
            el.controls = true;
            return el;
        }
    }

    // OpenGraph / oEmbed
    const raw = await fetchS(url);
    if (!raw) return null;

    const meta = {};
    const ogRegex = /<meta(?=[^>]*\bproperty=["']og:([^"']+)["'])(?=[^>]*\bcontent=["']([^"']+)["'])[^>]*>/gi;

    let m;
    while ((m = ogRegex.exec(raw))) {
        meta[m[1]] = m[2];
    }
    

    const container = document.createElement("div");
    container.className = "embedBox";

    if (meta.title) {
        const t = document.createElement("div");
        t.className = "embedTitle";
        t.textContent = unescapeHTML(meta.title);
        container.append(t);
    }

    if (meta.description) {
        const d = document.createElement("div");
        d.className = "embedDescription";
        d.textContent = unescapeHTML(meta.description);
        container.append(d);
    }

    if (meta.image) {
        const img = document.createElement("img");
        img.classList.add("embedImage", "genericImage");
        if (meta["image:width"]) img.style.width = meta["image:width"] + "px";
        if (meta["image:height"]) img.style.height = meta["image:height"] + "px";
        img.src = meta["image:secure_url"] || meta.image;
        if (o.startsWith("http://tenor.com"))
            return img;
        else
            container.append(img);
    }

    return container;
}

function buildMessage(msg, group, old = false) {
    const div = document.createElement("div");
    const username = document.createElement("p");
    const userPfp = document.createElement("img");
    const userDiv = document.createElement("div");
    const text = document.createElement("div");
    const emojis = document.createElement("div");
    emojis.classList.add("messageEmojis");

    const hoverMenu = document.createElement("div");
    hoverMenu.style.display = "none";
    div.addEventListener("mouseenter", () => { hoverMenu.style.display = "flex"; div.classList.add("messageHover") });
    div.addEventListener("mouseleave", () => { hoverMenu.style.display = "none"; div.classList.remove("messageHover") });
    hoverMenu.classList.add("messageControlMenu");
    const deleteMessage = document.createElement("button");
    deleteMessage.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash2-icon lucide-trash-2"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
    deleteMessage.classList.add("messageControlMenuButton");
    deleteMessage.classList.add("messageDeleteButton");
    if (msg.user !== userData.username) deleteMessage.style.display = checkPermissions("delete") ? "block" : "none";
    deleteMessage.onclick = () => ws.send(`{"cmd":"message_delete", "channel":"${currentChannel}", "id":"${msg.id}"}`);
    const reactMessage = document.createElement("button");
    reactMessage.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-smile-plus-icon lucide-smile-plus"><path d="M22 11v1a10 10 0 1 1-9-10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/><path d="M16 5h6"/><path d="M19 2v6"/></svg>`;
    reactMessage.classList.add("messageControlMenuButton");
    reactMessage.classList.add("messageReactButton");
    reactMessage.onclick = () => { 
        reactMessage.disabled = "true";
        const input = document.createElement("input");
        input.placeholder = "React";
        input.classList.add("messageReactionAddInput");
        input.addEventListener("keydown", (e) => {
            if (e.key == "Enter") {
                let valid = true;
                let val = input.value;
                if (val.length > 1 || val == "x") {
                    if (val.startsWith(":")) {
                        val = shortcodeToEmoji[val];
                        if (!val) valid = false;
                    } else {
                        val = shortcodeToEmoji[":" + val + ":"];
                        if (!val) valid = false;
                    }
                }
                if (val?.length == 0) valid = false;
                if (!reactedMessages[val]) reactedMessages[val] = [];
                if (valid) if (reactedMessages[val].includes(msg.id)) {
                    const i = reactedMessages[val].indexOf(msg.id);
                    if (i !== -1) reactedMessages[val].splice(i, 1);
                    ws.send(`{"cmd":"message_react_remove", "channel":"${currentChannel}", "emoji":"${val}", "id":"${msg.id}"}`);
                } else {
                    reactedMessages[val].push(msg.id);
                    ws.send(`{"cmd":"message_react_add", "channel":"${currentChannel}", "emoji":"${val}", "id":"${msg.id}"}`);
                }
                reactMessage.disabled = "";
                input.remove();
            }
        })
        hoverMenu.prepend(input);
        input.focus();
    }
    hoverMenu.append(reactMessage, deleteMessage);
    
    text.innerHTML = parseMarkdown(msg.content);
    div.classList.add("message");
    userDiv.classList.add("userDiv");
    username.classList.add("username");
    userPfp.classList.add("userPfp");
    text.classList.add("messageContent");
    const time = document.createElement("p");
    time.classList.add("userDivDate");
    time.textContent = formatDate(msg.timestamp);
    if (userColors[msg.user])
        username.style.color = userColors[msg.user];
    username.textContent = msg.user;
    userPfp.src = "";
    getPfp(msg.user).then(src => userPfp.src = src);
    userPfp.onclick = () => previewProfile(msg.user);
    userDiv.append(userPfp, username, time);
    const split = document.createElement("div");
    split.classList.add("messageSplit");
    const embeds = document.createElement("div");
    embeds.classList.add("messageEmbeds");
    div.append(embeds);

    if (group) {
        div.append(hoverMenu, text, embeds, emojis);
    } else {
        div.append(hoverMenu, userDiv, text, embeds, emojis);
    }

    const id = nextMessageCount++;
    div.id = `message-${id}`;
    split.id = `messageSplit-${id}`;

    const embedPromises = [];

    const urlRegex = /(?<!<)https?:\/\/[^\s<>]+(?!>)/g;
    const foundUrls = (msg.content.match(urlRegex) || []);
    for (const link of foundUrls) {
        const placeholder = document.createElement("div");
        placeholder.classList.add("embedPlaceholder");
        embeds.append(placeholder);

        const p = (async () => {
        const embedEl = await generateEmbed(link);
        if (embedEl) {
            placeholder.replaceWith(embedEl);
            const imgs = embedEl.querySelectorAll ? embedEl.querySelectorAll("img") : [];
            const imgLoadPromises = [...imgs].map(img => new Promise(res => {
                if (img.complete) return res();
                img.onload = img.onerror = () => res();
            }));
            await Promise.all(imgLoadPromises);
        } else {
            placeholder.remove();
        }
        if (embedEl && embedEl.classList.contains("embedBox") && embedEl.children.length === 0)
            embedEl.remove();
        })();
        embedPromises.push(p);
    }

    if (old) {
        if (msg.reactions) {
            const keys = Object.keys(msg.reactions);
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const value = msg.reactions[key];
                const div = document.createElement("div");
                div.classList.add(encodeEmoji(key))
                if (value.includes(userData.username)) {
                    if (!reactedMessages[key]) reactedMessages[key] = [];
                    reactedMessages[key].push(msg.id);
                    div.classList.add("messageReactionEnabled");
                }
                emojis.style.marginTop = "0.5em";
                try { div.classList.add(key, "messageReaction"); } catch {
                    continue;
                }
                div.textContent = `${key} ${value.length}`;
                emojis.append(div);
                div.onclick = () => { 
                    if (!reactedMessages[key]) reactedMessages[key] = [];
                    if (reactedMessages[key].includes(msg.id)) {
                        const i = reactedMessages[key].indexOf(msg.id);
                        if (i !== -1) reactedMessages[key].splice(i, 1);
                        div.classList.remove("messageReactionEnabled");
                        ws.send(`{"cmd":"message_react_remove", "channel":"${currentChannel}", "emoji":"${key}", "id":"${msg.id}"}`);
                    } else {
                        reactedMessages[key].push(msg.id);
                        div.classList.add("messageReactionEnabled");
                        ws.send(`{"cmd":"message_react_add", "channel":"${currentChannel}", "emoji":"${key}", "id":"${msg.id}"}`);
                    }
                }
            }
        }
    }

    messageStore[msg.id] = { el: div, data: msg };
    messageStore["count-" + id] = { el: div, data: msg };

    const hljsPromise = new Promise(res => {
        requestAnimationFrame(() => {
            text.querySelectorAll('pre code').forEach(block => {
                try { hljs.highlightElement(block); } catch {}
            });
            requestAnimationFrame(res);
        });
    });

    checkPing(msg).then(r => { if (r) div.classList.add("pingedMessage") })

    const ready = Promise.all([hljsPromise, ...embedPromises]);

    return { el: div, splitEl: split, ready, msgId: msg.id, data: msg };
}




async function newMsg(msg, old = false, f) {
    if (msg.channel !== currentChannel) if (msg.channel) { await checkPing(msg); return; };
    if (msg.type !== "message") return

    let obj
    
    let appendSplit = false;
    if ((old ? messageList[nextMessageCount + 1]?.user == msg.user : lastUser == msg.user) && (checkDates(old ? messageList[nextMessageCount + 1]?.timestamp : lastDate, msg.timestamp)))
        obj = buildMessage(msg, true, old);
    else {
        obj = buildMessage(msg, false, old);
        appendSplit = true;
    }
    
    lastDate = msg.timestamp;
    lastUser = msg.user;
    if (!old)
        f.append(obj.el);
    else
        f.prepend(obj.el);
    if (appendSplit)
        f.prepend(obj.splitEl);

    if (!old)
        requestAnimationFrame(() => messageArea.scrollTop = messageArea.scrollHeight + 100);
    
    
}

function encodeEmoji(str) {
    return "u" + Array.from(str)
        .map(c => c.codePointAt(0).toString(16))
        .join("-");
}

function checkDates(t1, t2) {
    const d1 = new Date(t1 * 1000);
    const d2 = new Date(t2 * 1000);
    if (d1.getDate() === d2.getDate() && d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear())
        if (d1.getHours() === d2.getHours())
            return true;
        else
            return false;
    else
        return false;
}

function renderUserlist(list) {
    const added = [];
    const userListDiv = document.querySelector("#userList");
    userListDiv.innerHTML = "";
    const onlineTitle = document.createElement("h3");
    onlineTitle.classList.add("userListTitle");
    onlineTitle.textContent = "Online";
    userListDiv.append(onlineTitle)
    for (const u of list) {
        if (!u?.username || added.includes(u.username))
            continue;
        const div = document.createElement("div");
        div.classList.add("userListItem");
        const icon = document.createElement("img");
        icon.onclick = () => previewProfile(u.username);
        icon.classList.add("userListIcon");
        getPfp(u.username).then((d) => icon.src = d);
        const name = document.createElement("p");
        name.onclick = () => previewProfile(u.username);
        name.classList.add("userListName");
        name.textContent = u.username;
        div.append(icon, name);
        added.push(u.username);
        userListDiv.append(div);
    }
    const offlineTitle = document.createElement("h3");
    offlineTitle.classList.add("userListTitle");
    offlineTitle.textContent = "Offline";
    userListDiv.append(offlineTitle);
    for (const u of userList) {
        if (!u?.username || added.includes(u.username))
            continue;
        const div = document.createElement("div");
        div.classList.add("userListItemOffline");
        const icon = document.createElement("img");
        icon.onclick = () => previewProfile(u.username);
        icon.classList.add("userListIcon");
        getPfp(u.username).then((d) => icon.src = d);
        const name = document.createElement("p");
        name.onclick = () => previewProfile(u.username);
        name.classList.add("userListName");
        name.textContent = u.username;
        div.append(icon, name);
        added.push(u.username);
        userListDiv.append(div);
    }
}

function formatDate(timestamp) {
    const cur = new Date(Date.now())
    const date = new Date(timestamp * 1000);
    function pad(s) {
        return String(s).padStart(2, "0");
    }

    if (cur.getDate() === date.getDate() && cur.getMonth() === date.getMonth() && cur.getFullYear() === date.getFullYear()) {
        return `${pad(date.getHours())}:${pad(date.getMinutes())}`
    } else {
        return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
}

async function toggleReact(data, add) {
    if (data.channel !== currentChannel) return;
    const el = messageStore[data.id].el;
    if (!el) throw new Error(`Unable to add reaction to message with ID '${data.id}'`);
    const emojiList = el.querySelector(".messageEmojis");
    if (emojiList) {
        const emoji = emojiList.querySelector(`.${encodeEmoji(data.emoji)}`);
        if (emoji) {
            if (add) {
                const count = Number(emoji.textContent.split(" ")[1].trim());
                emoji.textContent = `${data.emoji} ${count + 1}`;
            } else {
                const count = Number(emoji.textContent.split(" ")[1].trim());
                emoji.textContent = `${data.emoji} ${count - 1}`;
                if (count == 1) { emoji.remove(); if (emojiList.children.length == 0) emojiList.style.marginTop = "0"; }
            }
        } else {
            if (add) {
                const div = document.createElement("div");
                emojiList.style.marginTop = "0.5em";
                if (data.from == userData.username) div.classList.add("messageReactionEnabled");
                div.classList.add(encodeEmoji(data.emoji), "messageReaction");
                div.textContent = `${data.emoji} 1`;
                emojiList.append(div);
                div.onclick = () => { 
                    if (!reactedMessages[data.emoji]) reactedMessages[data.emoji] = [];
                    if (reactedMessages[data.emoji].includes(data.id)) {
                        const i = reactedMessages[data.emoji].indexOf(data.id);
                        if (i !== -1) reactedMessages[data.emoji].splice(i, 1);
                        div.classList.remove("messageReactionEnabled");
                        ws.send(`{"cmd":"message_react_remove", "channel":"${currentChannel}", "emoji":"${data.emoji}", "id":"${data.id}"}`);
                    } else {
                        div.classList.add("messageReactionEnabled");
                        reactedMessages[data.emoji].push(data.id);
                        ws.send(`{"cmd":"message_react_add", "channel":"${currentChannel}", "emoji":"${data.emoji}", "id":"${data.id}"}`);
                    }
                }
                
            } else {
                console.error(`Attempt to remove react '${data.emoji}' on message '${data.id}', but no such react found on message in DOM. Packet loss?`);
            }
        }
    }
}

async function deleteMessage(data) {
    if (data.channel !== currentChannel) return;
    const el = messageStore[data.id].el;
    const delMsg = messageStore[data.id].data;
    if (!el) throw new Error(`Unable to delete message with ID '${data.id}'`);
    const top = el.querySelector(".userDiv");
    if (top) {
        const count = Number(el.id.split("-")[1]) + 1
        const lower = messageArea.querySelector(`#message-${count}`);
        const msg = messageStore[`count-${count}`];
        if (lower) {
            if (msg.data.user == delMsg.user) {
                const split = document.createElement("div");
                split.classList.add("messageSplit");
                split.id = `messageSplit-${count}`;
                const userDiv = document.createElement("div");
                const username = document.createElement("p");
                const userPfp = document.createElement("img");
                const time = document.createElement("p");
                time.classList.add("userDivDate");
                time.textContent = formatDate(msg.data.timestamp);
                userDiv.classList.add("userDiv");
                username.classList.add("username");
                userPfp.classList.add("userPfp");
                username.textContent = msg.data.user;
                userPfp.src = await getPfp(msg.data.user);
                userPfp.onclick = () => previewProfile(msg.data.user);
                userDiv.append(userPfp, username, time);
                lower.insertBefore(userDiv, lower.children[1]);
                messageArea.insertBefore(split, lower);
            }
        }
    }
    delete messageStore[data.id];
    messageArea.querySelector(`#messageSplit-${el.id.split("-")[1]}`)?.remove();
    el.remove();
    const msgs = [...messageArea.children].reverse();
    const newest = messageStore["count-" + Number(msgs[0].id.split("-")[1])];
    lastUser = newest.data.user;
}

async function editMessage(data) {
    if (data.channel !== currentChannel) return;
    const el = messageStore[data.id].el;
    if (!el) throw new Error(`Unable to edit message with ID '${data.id}'`);
    const text = el.querySelector(".messageContent");
    if (text) text.innerHTML = parseMarkdown(data.content);
}

async function checkRatelimit(input) {
    if (ratelimit.active) {
        const placeholder = input.placeholder;
        input.disabled = true;
        while (ratelimit.ends > Date.now()) {
            input.value = "";
            if (ratelimit.type === "ratelimit")
                input.placeholder = `You have been ratelimited! You cannot send a message for ${Math.round((ratelimit.ends - Date.now()) / 1000)} seconds`;
            else if (ratelimit.type === "timeout")
                input.placeholder = `You are timed out! You cannot send a message for ${Math.round((ratelimit.ends - Date.now()) / 1000)} seconds`;
            await new Promise((r) => setTimeout(r, 1000));
        }
        setTimeout(() => {
            ratelimit.active = false;
            input.value = "";
            input.disabled = false;
            input.placeholder = placeholder;
        }, ratelimit.length)
    }
}

function initFuncs() {
    ws.onmessage = async(msg) => {
        let data = msg.data;
        try {
            data = JSON.parse(data);
        } catch {
            console.warn("Server returned invalid data for message, ignored.");
            return;
        }
        const cmd = data.cmd;
        switch (cmd) {
            case "handshake":
                serverInfo = {
                    messageLimit: data.val.limits?.post_content ? data.val.limits?.post_content : 65536,
                    ...data.val.server
                }
                title.textContent = `${serverInfo.name} — Originchats`;
                valKey = data.val.validator_key;
                const loginResp = await login();
                if (loginResp) ws.send(`{"cmd":"auth","validator":"${auth}"}`);
                break;
            case "auth_success":
                console.log("Server accepted auth");
                initUI();
                break;
            case "ready":
                userData = data.user;
                break;
            case "channels_get":
                channels = data.val;
                break;
            case "messages_get":
                messages = data.messages;
                break;
            case "ping":
                break;
            case "message_new":
                messageScroll++;
                const f = document.createDocumentFragment();
                await newMsg({ channel: data.channel, ...data.message }, false, f);
                messageArea.append(f);
                break;
            case "message_react_add":
                toggleReact({ from: data.from, id: data.id, channel: data.channel, emoji: data.emoji }, true);
                break;
            case "message_react_remove":
                toggleReact({ from: data.from, id: data.id, channel: data.channel, emoji: data.emoji }, false);
                break;
            case "message_delete":
                deleteMessage(data);
                break;
            case "message_edit":
                editMessage(data);
                break;
            case "error":
                if (data?.val === "Access denied to this channel") {
                    messages = "NotFound";
                    return;
                }
                notif(data.val, `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-triangle-alert-icon lucide-triangle-alert"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`);
                console.error(data.val);
                break;
            case "user_leave":
                if (data?.user === userData?.username) {
                    localStorage.setItem("openServer", "wss://chats.mistium.com");
                }
                break;

            case "user_ban":
                if (data?.user === userData?.username) {
                    localStorage.setItem("openServer", "wss://chats.mistium.com");
                }
                break;

            case "users_online":
                renderUserlist(data.users);
                break;

            case "user_connect":
                if (userList)
                    ws.send(`{"cmd":"users_online"}`);
                break;

            case "user_disconnect":
                if (userList)
                    ws.send(`{"cmd":"users_online"}`);
                break;

            case "users_list":
                userList = data.users;
                userColors = {};
                for (const user of userList) {
                    const name = user.username;
                    if (!user?.color || user.color === "white" || user.color.startsWith("#fff") || user.color === "rgb(255, 255, 255)") continue;
                    userColors[name] = user.color;
                }
                break;

            case "rate_limit":
                ratelimit.active = true;
                ratelimit.type = data?.reason?.includes("timeout") ? "timeout" : "ratelimit";
                ratelimit.length = data.length;
                ratelimit.ends = Date.now() + ratelimit.length;
                checkRatelimit(chatInput);
                break;

            default:
                console.warn(`Unknown command sent by server: '${cmd}'`);
                break;
        }
    }
}

async function login() {
    token = localStorage.getItem("token");
    if (token) {
        const res = await fetch(`https://social.rotur.dev/generate_validator?auth=${token}&key=${valKey}`);
        if (res.ok) {
            const data = await res.json();
            auth = data.validator;
            console.log("Successfully logged in using token");
            return true;
        } else {
            if (res.status === 524) {
                const lT = document.querySelector("#connectionText");
                if (lT) lT.remove();
                console.error("Rotur API endpoints are currently down (connection timeout).");
                mainDiv.innerHTML = "";
                mainDiv.style.display = "block";
                const error = document.createElement("h2");
                const errorIcon = document.createElement("div");
                errorIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-x-icon lucide-circle-x"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`;
                errorIcon.classList.add("connectErrorIcon")
                error.textContent = `Rotur API endpoints are currently down. If this issue persists, report this issue to the upholders of Rotur.`;
                error.classList.add("connectError");
                mainDiv.append(error, errorIcon);
                return false;
            } else if (res.status === 500) {
                const lT = document.querySelector("#connectionText");
                if (lT) lT.remove();
                console.error("Server-side error in auth process.", res.statusText);
                mainDiv.innerHTML = "";
                mainDiv.style.display = "block";
                const error = document.createElement("h2");
                const errorIcon = document.createElement("div");
                errorIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-x-icon lucide-circle-x"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`;
                errorIcon.classList.add("connectErrorIcon")
                error.textContent = `Failed to access validator, the Rotur server has reported an internal error. If this issue persists, report this issue to the upholders of Rotur.`;
                error.classList.add("connectError");
                mainDiv.append(error, errorIcon);
                return false;
            } else
                console.error("Failed to login using stored token. Opening login..");
        }
    }
    token = await window.electronAPI.login();
    const res = await fetch(`https://social.rotur.dev/generate_validator?auth=${token}&key=${valKey}`);
    if (res.ok) {
        const data = await res.json();
        auth = data.validator;
        console.log("Successfully logged in");
        localStorage.setItem("token", token);
        return true;
    } else {
        console.error("Failed to login!");
        return false;
    }
}


let serverMenuOpen = false;

async function openServerMenu() {
    if (serverMenuOpen == true) return;
    serverMenuOpen = true;
    const overlay = document.createElement("div");
    overlay.classList.add("serverNavigateMenuBackground");
    const input = document.createElement("input");
    input.classList.add("serverNavigateMenuInput");
    input.placeholder = "Enter a server URL";
    input.addEventListener("keydown", (e) => {
        if (e.key == "Enter") {
            if (input.value) {
                localStorage.setItem("openServer", input.value);
                window.location.reload();
            }
        }
    })
    overlay.append(input);
    mainDiv.append(overlay);
}

let gifPickerOpen = false;


const picker = document.createElement("div");
picker.classList.add("gifPickerDiv");
document.querySelector("#chatArea").append(picker);
picker.classList.add("closed");

function toggleGifPicker() {
    if (!gifPickerOpen) {
        gifPickerOpen = true;
        picker.innerHTML = "";
        picker.classList.remove("closed");
    } else {
        picker.classList.add("closed");
        gifPickerOpen = false;
        return;
    }

    const input = document.createElement("input");
    input.classList.add("gifPickerInput");
    input.placeholder = "Search for a GIF";

    const results = document.createElement("div");
    results.classList.add("gifPickerResults");

    picker.append(input, results);
}


async function initUI() {
    const channelSidebar = document.getElementById("channelSidebar");

    const serverInfoEl = document.querySelector("#serverInfo");
    const nameDiv = document.createElement("div");
    nameDiv.classList.add("serverInfoNameDiv");

    const name = document.createElement("h2");
    name.classList.add("serverInfoName");

    const icon = document.createElement("img");
    icon.classList.add("serverInfoIcon");

    const leaveButton = document.createElement("button");
    leaveButton.classList.add("serverLeaveButton");
    leaveButton.textContent = "Leave the server";
    leaveButton.onclick = () => {
        ws.send(`{"cmd":"user_leave"}`);
        leaveButton.disabled = "true";
    }

    name.textContent = serverInfo.name;
    icon.src = serverInfo.icon;

    nameDiv.append(icon, name);
    serverInfoEl.append(nameDiv, leaveButton);


    ws.send('{"cmd":"channels_get"}');
    while (!channels) {
        await new Promise((r) => setTimeout(r, 50));
    }

    ws.send('{"cmd":"users_list"}');
    while (!userColors) {
        await new Promise((res) => setTimeout(res, 10));
    }
    ws.send(`{"cmd":"users_online"}`);
    mainDiv.style.display = "block";
    const lT = document.querySelector("#connectionText");
    if (lT) lT.remove();

    window.addEventListener("keydown", (e) => {
        if (e.key == "k" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            openServerMenu();
        } else if (e.key == "Escape") {
            if (serverMenuOpen) {
                const overlay = document.querySelector(".serverNavigateMenuBackground");
                if (overlay) { overlay.remove(); serverMenuOpen = false; }
            }
        } else if (e.key == ","  && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (!settingsOpen)
                openSettings();
            else 
                closeSettings();
        }
    })


    let loadingMsgs = false;

    async function loadMessages(start, name) {
        if (loadingMsgs) return;
        loadingMsgs = true;
        ws.send(`{"cmd":"messages_get", "channel":"${name}", "start":${start}, "limit":50}`);
        while (!messages) {
            await new Promise((r) => setTimeout(r, 50));
        }
        if (messages === "NotFound") {
            const error = document.createElement("h2");
            const errorIcon = document.createElement("div");
            error.classList.add("unknownChannelError");
            error.textContent = "Channel not found";
            errorIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-x-icon lucide-circle-x"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`;
            errorIcon.classList.add("connectErrorIcon")
            messageArea.append(error, errorIcon);
            if (!ratelimit.active) {
                chatInput.disabled = "true";
                chatInput.placeholder = `Open a channel to send messages`;
            }
            messages = null;
            loadingMsgs = false;
            return;
        }
        messageList = messages.reverse();
        messages = null;
        lastUser = messageList[0]?.user;
        const f = document.createDocumentFragment();
        for (let i = 0; i < messageList.length; i++) {
            const msg = messageList[i];
            await newMsg({ ...msg, channel: name }, true, f);
            if (start === 0)
                messageArea.scrollTop = messageArea.scrollHeight + 100;
        }
        messageArea.prepend(f);
        loadingMsgs = false;
    }

    async function openChannel(name, perms) {
        messageArea.innerHTML = "";
        messageScroll = 0;
        lastUser = null;
        lastDate = null;
        nextMessageCount = 0;
        messageList = [];
        messageStore = {};
        const channelDiv = channelSidebar.querySelector("#channel-" + name);
        if (channelDiv) channelDiv.textContent = "#" + name;
        currentChannel = name;
        if (!ratelimit.active) {
            chatInput.disabled = "";
            chatInput.placeholder = `Send a message in #${name}`;
        }
        title.textContent = `#${name} — ${serverInfo.name} — Originchats`;
        currentPermissions = perms;
        await loadMessages(messageScroll, name);
        messageArea.scrollTop = messageArea.scrollHeight + 10000;
    }
    window.openChannel = openChannel;

    if (!channelSidebar) return;

    for (const channel of channels) {
        const div = document.createElement("div");
        if (channel.type === "separator") { div.classList.add("channelSeparator"); div.style.margin = `${channel.size / 15}em auto`} else { div.classList.add("channel"); div.textContent = "#" + channel.name; div.onclick = () => openChannel(channel.name, channel.permissions); }
        div.id = "channel-" + channel.name;
        channelSidebar.append(div);
    }

    /*const gifPicker = document.querySelector("#gifPicker");
    gifPicker.onclick = () => {
        toggleGifPicker();
    }*/

    chatInput.addEventListener("keydown", (e) => {
        if (!currentChannel) return;
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            ws.send(`{"cmd":"message_new", "channel":"${currentChannel}", "content":${JSON.stringify(chatInput.value)}}`);
            chatInput.value = "";
            chatInputUpdate();
        } else if (e.key === "Enter") {
            e.preventDefault()
            document.execCommand("insertLineBreak");
            chatInputUpdate();
        }
    })

    function chatInputUpdate() {
        chatInput.value = replaceShortcodes(chatInput.value);

        chatInput.style.height = 'auto';

        chatInput.style.height = Math.min(chatInput.scrollHeight - 4, 100) + "px";
    }
    
    let lastScrolled = 0;

    messageArea.addEventListener("scroll", () => {
        if (messageArea.scrollHeight > messageArea.offsetHeight) {
            if (lastScrolled + 5000 > Date.now()) return;
            if (messageArea.scrollTop < 10) {
                messageArea.scrollTop = 500;
                messageScroll += 50;
                lastScrolled = Date.now();
                loadMessages(messageScroll, currentChannel);
            }
        }
    })


    chatInput.addEventListener("input", () => {
        chatInputUpdate();
    });

}
url = localStorage.getItem("openServer") ?? "wss://chats.mistium.com/";
await connect(url);
