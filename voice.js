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

    init(customTurn) {
        if (customTurn)
            this.peer = new Peer(null, {
                debug: 2,
                config: {
                    iceServers: JSON.parse(customTurn),
                    iceTransportPolicy: "relay"
                }
            });
        else
            this.peer = new Peer(null, {
                debug: 2,
                config: {
                    iceServers: [
                        {
                            urls: 'turn:free.expressturn.com:3478',
                            username: '000000002088395920',
                            credential: 'igxH3ZLYfEC4tyG0oqmuJYmGNBk='
                        }
                    ],
                    iceTransportPolicy: "relay"
                }
            });

        this.peer.on("open", (id) => {
            this.id = id;
        });

        this.peer.on("call", async (call) => {
            call.answer(this.localStream || new MediaStream([this.#silentTrack()]));

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
                    document.querySelector(".vcStreamContainer")?.appendChild(el);

                } else if (!this.calls.has(call.peer)) {
                    this.calls.set(call.peer, call);
                    this.addStream(stream, call.peer);
                }
            });

            call.on("close", () => {
                if (this.videoStreams.has(call.peer)) {
                    this.videoStreams.delete(call.peer);
                    this.videoCalls.delete(call.peer);
                    const el = document.getElementById(`strm-${call.peer}`);
                    if (el) el.remove();
                } else {
                    this.removePeer(call.peer);
                }
            });

            call.on("error", () => {
                this.videoStreams.delete(call.peer);
                this.videoCalls.delete(call.peer);
                const el = document.getElementById(`strm-${call.peer}`);
                if (el) el.remove();
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
        if (this.calls.has(peerId)) return;

        try {
            const call = this.peer.call(peerId, this.localStream);
            this.setupCallHandlers(call, peerId);
            this.calls.set(peerId, call);

            if (this.videoStream) {
                const vcall = this.peer.call(peerId, this.videoStream, { metadata: { video: true } });
                vcall.on("stream", s => this.videoStreams.set(peerId, s));
                vcall.on("close", () => this.videoStreams.delete(peerId));
                vcall.on("error", e => console.warn("video call error", e));
                this.videoCalls.set(peerId, vcall);
            }
        } catch (e) {
            console.warn("Voice connect failed", e);
        }
    }

    setupCallHandlers(call, id) {
        call.on("stream", stream => {
            this.addStream(stream, id);
        });
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

    isValidVideoStream(stream) {
        const videoTracks = stream.getVideoTracks();
        if (!videoTracks.length) return false;

        return videoTracks.some(track => track.readyState === 'live' && track.enabled);
    }

    async setVideoStream(stream) {
        const closePromises = [];
        this.videoCalls.forEach(c => {
            closePromises.push(new Promise(resolve => {
                c.on("close", resolve);
                c.on("error", resolve);
                try { c.close(); } catch {}
                setTimeout(resolve, 1000);
            }));
        });

        this.videoCalls.clear();
        this.videoStreams.clear();
        document.querySelectorAll('.vcStream:not(#local-stream)').forEach(el => el.remove());

        this.videoStream = stream;

        await Promise.all(closePromises);

        this.videoStreams.forEach((existingStream, peerId) => {
            if (!document.getElementById(`strm-${peerId}`)) {
                const el = document.createElement("video");
                el.id = `strm-${peerId}`;
                el.playsInline = true;
                el.autoplay = true;
                el.controls = false;
                el.srcObject = existingStream;
                el.classList.add("vcStream");
                document.querySelector(".vcStreamContainer")?.appendChild(el);
            }
        });

        this.users.forEach((peerId) => {
            if (!this.peer || !peerId) return;
            if (peerId === this.id) return; 
            const vcall = this.peer.call(peerId, stream, { metadata: { video: true } });
            vcall.on("stream", s => {
                if (!this.isValidVideoStream(s)) return;
                const old = document.getElementById(`strm-${peerId}`);
                if (old) old.remove();
                this.videoStreams.set(peerId, s);

                const el = document.createElement("video");
                el.id = `strm-${peerId}`;
                el.playsInline = true;
                el.autoplay = true;
                el.controls = false;
                el.srcObject = s;
                el.classList.add("vcStream");
                document.querySelector(".vcStreamContainer")?.appendChild(el);
            });
            vcall.on("close", () => {
                this.videoStreams.delete(peerId);
                const el = document.getElementById(`strm-${peerId}`);
                if (el) el.remove();
            });
            vcall.on("error", e => console.warn("video call error", e));
            this.videoCalls.set(peerId, vcall);
        });
    }

    stopVideoStream() {
        if (this.videoStream) {
            this.videoStream.getTracks().forEach(t => t.stop())
            this.videoStream = null
        }

        this.videoCalls.forEach(c => c.close())
        this.videoCalls.clear()
        this.videoStreams.clear()

        const el = document.getElementById('local-stream')
        if (el) el.remove()
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