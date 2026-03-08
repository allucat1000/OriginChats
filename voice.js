import { ws } from "./main.js";

export class Voice {
    constructor() {
        this.peer = null;
        this.connections = new Map();
        this.calls = new Map();
        this.localStream = null;
        this.forceMuted = false;
        this.muted = false;
        this.currentVC = null;
        this.id = null;
        this.audioContexts = new Map();
        this.audioContainers = new Map();
    }

    init() {
        this.peer = new this.peer(null, {
            debug: 2
        });

        this.peer.on("open", (id) => this.id = id);

        this.peer.on("call", (c) => {
            c.answer(this.localStream);
            this.calls.set(c.peer, c);
        })
    }

    async join(channel) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch { this.forceMuted = true };

        this.currentVC = channel;
        ws.send(JSON.stringify({
            cmd: "voice_join",
            channel,
            peer_id: this.peer_id
        }));
    }

    async leave() {
        if (!this.currentVC) return;

        ws.send(JSON.stringify({
            cmd: "voice_leave"
        }));

        this.calls.forEach(call => {
            call.close();
        });
        this.calls.clear();

        this.audioContexts.forEach(ac => {
            if (ac && ac.close)
                try { ac.close(); } catch {};
        });
        this.audioContexts.clear();

        this.currentVC = null;
        this.connections.clear();
    }

    async connect(peer, username) {
        if (this.connections.has(peer)) return;

        try {
            const conn = this.peer.connect(peer);
            this.connections.set(peer, conn);

            const call = this.peer.call(peer, this.localStream);
            this.setupCallHandlers(call, peer, username);
            this.calls.set(peer, call);

        } catch {};
    }

    addStream(s, id) {
        const a = new Audio();
        a.srcObject = s;
        a.autoplay = true;
        this.audioContainers.set(id, a);
        this.setupMic(s, id);
    }

    setupMic(s, id) {
        try {
            const ac = new AudioContext();
            const src = ac.createMediaStreamSource(s);
            const an = ac.createAnalyser();
            an.fftSize = 256;
            src.connect(an);

            const dArr = new Uint8Array(an.frequencyBinCount);

        } catch {}
    }

    callHandlers(call, id) {
        call.on("stream", s => {

        })
    }
}