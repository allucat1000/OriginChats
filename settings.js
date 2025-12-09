export { openSettings, closeSettings, settingsOpen };
import { mainDiv, config } from "./main.js"

let bg;
let settingsOpen = false;

function openTab(data, content, path) {
    content.innerHTML = "";
    console.log(data);
    for (let id = 0; id < data.length; id++) {
        const o = data[id];
        const div = document.createElement("div");
        div.classList.add("settingsMenuContentOptionDiv");

        const title = document.createElement("h2");
        title.classList.add("settingsMenuContentOptionTitle");
        title.textContent = o.name;

        const desc = document.createElement("p");
        desc.classList.add("settingsMenuContentOptionDesc");
        desc.textContent = o.description;

        div.append(title, desc);

        switch (o.type) {
            case "input":{
                const i = document.createElement("input");
                i.classList.add("settingsMenuContentOptionInputType");
                i.value = o.state == false ? "" : o.state;
                i.addEventListener("input", () => {
                    const val = i.value?.length == 0 ? false : i.value;
                    o.state = val;
                    console.log(config[path[0]][path[1]], id )
                    config[path[0]][path[1]][id].state = val;
                    localStorage.setItem("config", JSON.stringify(config));
                });
                div.append(i);
                break;
            }
            default:
                console.error(`Unknown settings option type ${o.type}`);
                continue;

        }
        content.append(div);
    }
}

function openSettings() {
    settingsOpen = true;
    bg = document.createElement("div");
    bg.classList.add("settingsMenuBackground");

    const sidebar = document.createElement("div");
    sidebar.classList.add("settingsMenuSidebar");

    const content = document.createElement("div");
    content.classList.add("settingsMenuContent");

    bg.append(sidebar, content);

    console.log(config);

    const title = document.createElement("h2");
    title.textContent = "Settings";
    title.classList.add("settingsMenuSidebarTitle");
    const splitter = document.createElement("div");
    splitter.classList.add("settingsMenuSidebarSplitter");
    sidebar.append(title, splitter);

    for (let i = 0; i < config.length; i++) {
        const x = config[i];

        for (const [tabName, data] of Object.entries(x)) {
            const tab = document.createElement("div");
            tab.classList.add("settingsMenuSidebarTab");
            tab.textContent = tabName;

            tab.onclick = () => openTab(data, content, [i, tabName]);

            sidebar.append(tab);
        }
    }

    mainDiv.append(bg);
};

function closeSettings() {
    settingsOpen = false;
    if (bg) bg.remove();
}