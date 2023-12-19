/**************/
/*** CONFIG ***/
/**************/
const PORT = 8080;


/*************/
/*** SETUP ***/
/*************/
const fs = require("fs");
const express = require('express');
// var http = require('http');
const https = require("https");
const bodyParser = require('body-parser');
const { channel } = require("diagnostics_channel");
const main = express()
// const server = http.createServer(main)


let privateKey, certificate;

privateKey = fs.readFileSync("ssl/server-key.pem", "utf8");
certificate = fs.readFileSync("ssl/server-cert.pem", "utf8");
const credentials = { key: privateKey, cert: certificate };
const server = https.createServer(credentials, main);
// const server = http.createServer(main);

const io = require('socket.io')(server);
//io.set('log level', 2);

server.listen(PORT, null, function () {
    console.log("Listening on port " + PORT);
});
//main.use(express.bodyParser());

main.get('/', function (req, res) { res.sendFile(__dirname + '/client.html'); });
// function getTopKeys(map) {
//     const mapEntries = Object.entries(map);
//     mapEntries.sort((a, b) => b[1].length - a[1].length);
//     const top5Keys = mapEntries.slice(0, 5).map(entry => entry[0]);
//     return top5Keys;
// }

// main.get('/toprooms', function (req, res) {
//     if (channels)
//         res.send({
//             "topRooms": getTopKeys(channels)
//         });
//     else {
//         res.status(500).send("Channels not defined.");
//     }
// });
// main.get('/client.html', function(req, res){ res.sendfile('newclient.html'); });



/*************************/
/*** INTERESTING STUFF ***/
/*************************/
var channels = {};
var sockets = {};

/**
 * Users will connect to the signaling server, after which they'll issue a "join"
 * to join a particular channel. The signaling server keeps track of all sockets
 * who are in a channel, and on join will send out 'addPeer' events to each pair
 * of users in a channel. When clients receive the 'addPeer' even they'll begin
 * setting up an RTCPeerConnection with one another. During this process they'll
 * need to relay ICECandidate information to one another, as well as SessionDescription
 * information. After all of that happens, they'll finally be able to complete
 * the peer connection and will be streaming audio/video between eachother.
 */
io.sockets.on('connection', function (socket) {
    console.log("Connection event called");
    socket.channels = {};
    sockets[socket.id] = socket;

    console.log("[" + socket.id + "] connection accepted");

    socket.on('disconnect', function () {
        console.log("Disconnect event called");
        for (var channel in socket.channels) {
            part(channel);
        }
        console.log("[" + socket.id + "] disconnected");
        delete sockets[socket.id];
    });

    socket.on('join', function (config) {
        console.log("Join event called");
        console.log("[" + socket.id + "] join ", config);
        var channel = config.channel;
        var userdata = config.userdata;
        socket.userdata = userdata;

        if (channel in socket.channels) {
            console.log("[" + socket.id + "] ERROR: already joined ", channel);
            return;
        }

        if (!(channel in channels)) {
            console.log(`Creating a new room with id: ${channel}`);
            channels[channel] = {};
        }

        for (id in channels[channel]) {
            console.log("New User [" + socket.id + "] Informing Old User [" + id + "] to addPeer");
            channels[channel][id].emit('addPeer', { 'peer_id': socket.id, 'should_create_offer': false, 'userdata': socket.userdata });
            console.log("New User [" + socket.id + "] Being Informed about Old User [" + id + "] to addPeer");
            socket.emit('addPeer', { 'peer_id': id, 'should_create_offer': true, 'userdata': channels[channel][id].userdata });
        }

        channels[channel][socket.id] = socket;
        socket.channels[channel] = channel;
    });

    function part(channel) {
        console.log("Part event called");
        console.log("[" + socket.id + "] part ");

        if (!(channel in socket.channels)) {
            console.log("[" + socket.id + "] ERROR: not in ", channel);
            return;
        }

        delete socket.channels[channel];
        delete channels[channel][socket.id];

        for (id in channels[channel]) {
            channels[channel][id].emit('removePeer', { 'peer_id': socket.id });
            socket.emit('removePeer', { 'peer_id': id });
        }
    }
    socket.on('part', part);

    socket.on('relayICECandidate', function (config) {
        console.log("RelayIceCandidate event called");
        var peer_id = config.peer_id;
        var ice_candidate = config.ice_candidate;
        console.log("[" + socket.id + "] relaying ICE candidate to [" + peer_id + "] ", ice_candidate);

        if (peer_id in sockets) {
            sockets[peer_id].emit('iceCandidate', { 'peer_id': socket.id, 'ice_candidate': ice_candidate });
        }
    });

    socket.on('message', function (data) {
        // expected input {'channel': roomName, 'message': message}
        ch = data.channel;
        msg = data.message;
        console.log("[" + socket.id + "] broadcasting on channel '" + ch + "' a message: " + data.message);
        for (id in channels[ch]) {
            channels[ch][id].emit('broadcastMsg', { 'peer_id': socket.id, 'message': msg, 'userData': socket.userdata });
        }
    });

    socket.on('relaySessionDescription', function (config) {
        console.log("RelaySessionDescription event called");
        var peer_id = config.peer_id;
        var session_description = config.session_description;
        console.log("[" + socket.id + "] relaying session description to [" + peer_id + "] ", session_description);

        if (peer_id in sockets) {
            console.log(`Relaying Session Description to ${peer_id}`);
            sockets[peer_id].emit('sessionDescription', { 'peer_id': socket.id, 'session_description': session_description });
        }
    });
});
