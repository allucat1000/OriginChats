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
        this.users = new Map();
    }

    init() {
        this.peer = new Peer(null, {
            debug: 2
        });

        this.peer.on("open", (id) => {
            this.id = id;
        });

        this.peer.on("call", (call) => {
            call.answer(this.localStream);
            this.setupCallHandlers(call, call.peer);
            this.calls.set(call.peer, call);
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

        ws.send(JSON.stringify({
            cmd: "voice_leave"
        }));

        this.calls.forEach(call => call.close());
        this.calls.clear();

        this.audioContexts.forEach(ac => {
            if (ac && ac.close) {
                try { ac.close(); } catch {}
            }
        });

        this.audioContexts.clear();

        this.audioContainers.forEach(a => {
            try { a.pause(); } catch {}
        });

        this.audioContainers.clear();

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

        } catch (e) {
            console.warn("Voice connect failed", e);
        }
    }

    setupCallHandlers(call, id, username) {
        call.on("stream", (stream) => {
            this.addStream(stream, id);
        });

        call.on("close", () => {
            this.removePeer(id);
        });

        call.on("error", () => {
            this.removePeer(id);
        });
    }

    removePeer(id) {
        const audio = this.audioContainers.get(id);
        if (audio) {
            try { audio.pause(); } catch {}
            this.audioContainers.delete(id);
        }

        const ctx = this.audioContexts.get(id);
        if (ctx) {
            try { ctx.close(); } catch {}
            this.audioContexts.delete(id);
        }

        this.calls.delete(id);
        this.connections.delete(id);
    }

    addStream(stream, id) {
        const audio = new Audio();
        audio.srcObject = stream;
        audio.autoplay = true;

        this.audioContainers.set(id, audio);

        this.setupMic(stream, id);
    }

    setupMic(stream, id) {
        try {
            const ac = new AudioContext();

            const src = ac.createMediaStreamSource(stream);
            const analyser = ac.createAnalyser();

            analyser.fftSize = 256;

            src.connect(analyser);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            const loop = () => {
                analyser.getByteFrequencyData(dataArray);

                const avg =
                    dataArray.reduce((a, b) => a + b, 0) / dataArray.length;


                requestAnimationFrame(loop);
            };

            loop();

            this.audioContexts.set(id, ac);

        } catch (e) {
            console.warn("mic analyser failed", e);
        }
    }

    userLeft(user) {
        const id = this.users.get(user);

        if (id) {
            const ac = this.audioContexts.get(id);
            if (ac && ac.close) {
                ac.close();
            }
            this.audioContexts.delete(id);
            const call = this.calls.get(peerId);
            if (call) {
                call.close();
                this.calls.delete(peerId);
            }
            const conn = this.connections.get(peerId);
            if (conn) {
                conn.close();
                this.connections.delete(peerId);
            }
            this.users.delete(user);
        }
    }

    userJoin(user, id) {
        this.users.set(user, id);
    };
}