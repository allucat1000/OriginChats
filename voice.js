import { ws } from "./main.js";

export class Voice {
    constructor() {
        this.peer = null;
        this.connections = new Map();
        this.calls = new Map();
        this.videoCalls = new Map();
        this.localStream = null;
        this.videoStream = null;
        this.forceMuted = false;
        this.muted = false;
        this.currentVC = null;
        this.id = null;
        this.audioContexts = new Map();
        this.audioContainers = new Map();
        this.videoStreams = new Map();
        this.users = new Map();
    }

    init(turnServers) {
        if (turnServers)
            this.peer = new Peer(null, {
                debug: 2,
                config: {
                    iceServers: JSON.parse(turnServers),
                    iceTransportPolicy: "relay"
                },
            });
        else
            this.peer = new Peer(null, {
                debug: 2
            });

        this.peer.on("open", (id) => {
            this.id = id;
        });

        this.peer.on("call", async (call) => {
            const useStream = call.metadata?.video ? this.videoStream : this.localStream || new MediaStream([this.#silentTrack()]);
            call.answer(useStream);

            if (call.metadata?.video) this.videoCalls.set(call.peer, call);
            else this.calls.set(call.peer, call);

            call.on("stream", (stream) => {

                if (stream.getVideoTracks().length > 0 && !this.videoStreams.has(call.peer)) {
                    this.videoStreams.set(call.peer, stream);

                    const el = document.createElement("video");
                    el.id = `strm-${call.peer}`;
                    el.playsInline = true;
                    el.autoplay = true;
                    el.controls = false;
                    el.srcObject = stream;
                    el.classList.add("vcStream");
                    const container = document.querySelector(".vcStreamContainer");
                    if (container) container.appendChild(el);
                } else {
                    this.addStream(stream, call.peer);
                }
            });

            call.on("close", () => {
                if (this.videoStreams.has(call.peer)) {
                    this.videoStreams.delete(call.peer);

                    const el = document.getElementById(`strm-${call.peer}`);
                    if (el) el.remove();
                } else {
                    this.removePeer(call.peer);
                }

                this.videoCalls.delete(call.peer);
            });

            call.on("error", () => {
                if (call.metadata?.video) this.videoStreams.delete(call.peer);
                else this.removePeer(call.peer);
            });
        });
    }

    #silentTrack() {
        const ctx = new AudioContext();

        const oscillator = ctx.createOscillator();
        oscillator.frequency.value = 0;
        oscillator.start();
        oscillator.stop(ctx.currentTime);

        const dst = ctx.createMediaStreamDestination();
        oscillator.connect(dst);

        const track = dst.stream.getAudioTracks()[0];
        return track;
    }

    async join(channel) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            });
        } catch {
            this.forceMuted = true;
            this.localStream = new MediaStream([this.#silentTrack()]);
        }

        this.currentVC = channel;

        ws.send(JSON.stringify({
            cmd: "voice_join",
            channel,
            peer_id: this.id
        }));
    }

    async leave() {
        if (!this.currentVC) return;

        ws.send(JSON.stringify({ cmd: "voice_leave" }));

        this.calls.forEach(c => c.close());
        this.calls.clear();

        this.videoCalls.forEach(c => c.close());
        this.videoCalls.clear();
        this.videoStreams.clear();

        this.audioContexts.forEach(ac => { if (ac?.close) { try { ac.close(); } catch {} } });
        this.audioContexts.clear();

        this.audioContainers.forEach(a => { try { a.pause(); } catch {} });
        this.audioContainers.clear();

        this.currentVC = null;
        this.connections.clear();
    }

    async connect(peerId, username) {
        if (this.connections.has(peerId)) return;

        try {
            const conn = this.peer.connect(peerId);
            this.connections.set(peerId, conn);

            const call = this.peer.call(peerId, this.localStream, { metadata: { video: false } });
            this.setupCallHandlers(call, peerId);
            this.calls.set(peerId, call);

            if (this.videoStream) {
                const vcall = this.peer.call(peerId, this.videoStream, { metadata: { video: true } });
                vcall.on("stream", stream => this.videoStreams.set(peerId, stream));
                vcall.on("close", () => this.videoStreams.delete(peerId));
                this.videoCalls.set(peerId, vcall);
            }
        } catch (e) {
            console.warn("Voice connect failed", e);
        }
    }

    setupCallHandlers(call, id) {
        call.on("stream", stream => this.addStream(stream, id));
        call.on("close", () => this.removePeer(id));
        call.on("error", () => this.removePeer(id));
    }

    addStream(stream, id) {
        const audio = new Audio();
        audio.srcObject = stream;
        audio.autoplay = true;
        this.audioContainers.set(id, audio);

        if (!stream.getAudioTracks().length) return;

        try {
            const ac = new AudioContext();
            const src = ac.createMediaStreamSource(stream);
            const analyser = ac.createAnalyser();
            analyser.fftSize = 256;
            src.connect(analyser);
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const loop = () => { analyser.getByteFrequencyData(dataArray); requestAnimationFrame(loop); };
            loop();
            this.audioContexts.set(id, ac);
        } catch {}
    }

    removePeer(id) {
        const audio = this.audioContainers.get(id);
        if (audio) { try { audio.pause(); } catch {} this.audioContainers.delete(id); }
        const ac = this.audioContexts.get(id);
        if (ac) { try { ac.close(); } catch {} this.audioContexts.delete(id); }
        this.calls.delete(id);
        this.connections.delete(id);
    }

    setVideoStream(stream) {
        this.videoStream = stream;
        this.connections.forEach((_, peerId) => {
            const oldCall = this.videoCalls.get(peerId);
            if (oldCall) oldCall.close();
            const vcall = this.peer.call(peerId, this.videoStream, { metadata: { video: true } });
            vcall.on("stream", s => this.videoStreams.set(peerId, s));
            vcall.on("close", () => this.videoStreams.delete(peerId));
            this.videoCalls.set(peerId, vcall);
        });
    }

    userLeft(user) {
        const id = this.users.get(user);
        if (!id) return;

        const ac = this.audioContexts.get(id);
        if (ac) { ac.close(); this.audioContexts.delete(id); }

        const call = this.calls.get(id);
        if (call) { call.close(); this.calls.delete(id); }

        const vcall = this.videoCalls.get(id);
        if (vcall) { vcall.close(); this.videoCalls.delete(id); }

        const vidEl = document.getElementById(`strm-${id}`);
        if (vidEl) vidEl.remove();

        this.connections.delete(id);
        this.users.delete(user);
        this.videoStreams.delete(id);
        const container = document.querySelector(".vcUserContainer");
        if (container) {
            const p = container.querySelector("." + user);
            if (p) p.remove();
        }
    }

    userJoin(user, id) {
        this.users.set(user, id);
    }
}