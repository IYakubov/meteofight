ROCK DRIFT — Tilt-Controlled Asteroid Dodging
=============================================

Fly freely around the screen dodging drifting asteroids. One screen (PC, TV,
laptop) shows the field. You connect from your phone and steer your ship by
physically tilting the phone. Play solo and try to survive as long as
possible, or go head-to-head with a friend — first ship to take 5 asteroid
hits blows up and loses the round.

HOW IT PLAYS
------------
Asteroids of different sizes drift across the field and bounce off each
other and the edges. Tilt your phone to fly anywhere on screen — forward to
go up, back to go down, left/right to strafe. There's no shooting; your
only job is to not get hit. Take 5 hits and your ship blows up. New waves
bring more and faster rocks the longer the round runs.

  SOLO      Survive as long as you can. Your best time is saved on this
            browser and shown on the big screen.
  2 PLAYERS Both pilots share the same field. Whoever blows up first loses
            the round (both dying in the same instant is a draw). Play as
            many rounds as you like — the score carries across rounds until
            you start a new game.

REQUIREMENTS
------------
Node.js 16 or newer.

IMPORTANT — HTTPS IS REQUIRED FOR THE PHONE CONTROLLER
--------------------------------------------------------
Phone motion sensors (the "gravity sensor" / tilt input, technically the
DeviceOrientation API) only work in a secure context. That means the page
the CONTROLLER is opened on must be served over HTTPS (or be
"http://localhost", which only works if the phone and the server are the
literal same device — not useful here since you need one or two separate
phones).

Plain "http://192.168.x.x:3000" on your home WiFi will NOT unlock the tilt
sensor on modern iOS/Android browsers. You have two easy options:

  OPTION A — Deploy it (recommended, and what "deploy to GitHub" usually
  means in practice — GitHub itself only hosts the code, you still need a
  place to run a Node.js server):
    1. Push this project to a GitHub repository.
    2. Connect that repo to a free Node.js host that gives you HTTPS
       automatically, e.g. Render.com, Railway.app, Fly.io, or Glitch.
       Typical settings: Build command "npm install", start command
       "npm start" (or "node server.js").
    3. Once deployed you'll get a URL like
       https://your-app.onrender.com — open that on the PC for the
       display, and the same URL + /controller.html on each phone.

  OPTION B — Play locally over an HTTPS tunnel (fastest for testing):
    1. Run the server locally: npm install && npm start
    2. In another terminal, run a tunnel tool such as ngrok:
           ngrok http 3000
       (or use localtunnel / Cloudflare Tunnel — anything that gives you
       an https:// URL pointing at your local port 3000)
    3. Open the PC display either locally (http://localhost:3000) or via
       the same https tunnel URL, and open
       https://<your-tunnel-domain>/controller.html on each phone.

SETUP
-----
1. Open a terminal in this folder.
2. Install dependencies:
       npm install
3. Start the server:
       npm start
   You should see:
       ROCK DRIFT server running on http://localhost:3000

HOW TO PLAY
------------
1. On the PC/TV/laptop that will display the field, open a browser to the
   server's URL (see the HTTPS note above). Click "Solo Flight" for one
   pilot, or "2 Players" for two. A 6-digit room code appears, along with
   a QR code for each pilot to connect and one to watch.

2. On each phone, scan the join QR code (or open
   <your-url>/controller.html and type the room code in). In 2-player
   mode the first phone to join becomes Pilot 1, the second Pilot 2.

3. The controller will ask for motion permission on iOS (tap "Enable
   Motion Controls"). Then you'll see a calibration screen: hold the
   phone comfortably upright in front of you and tap "Calibrate &
   Continue" — that position becomes your neutral center.

4. Tap "Ready for Launch". In solo mode the round starts immediately. In
   2-player mode it starts as soon as BOTH pilots are ready.

5. Fly! Tilt the phone away from your calibrated center:
     - Tilt forward (top of phone away from you)  → fly up
     - Tilt back (top of phone toward you)         → fly down
     - Tilt left / right                            → fly left / right
   If tilting ever feels reversed for how you like to hold the phone, use
   the "Invert fwd/back" or "Invert left/right" chips on the calibration
   screen, and the Gentle / Normal / Sharp chips to change how far you
   need to tilt for full deflection. You can tap "Recalibrate" any time,
   even mid-flight, if your resting position drifts.

GAMEPLAY
--------
- The field is full of drifting asteroids of three rough sizes; they
  bounce off each other and off the walls, so the field keeps moving even
  if you sit still.
- You have 5 HP (hearts, top corner — and on your own phone). Colliding
  with an asteroid costs 1 HP, with a brief invulnerability flash
  afterward. Reach 0 HP and your ship blows up.
- In 2-player mode, ships gently bump off each other (no damage) so you
  can't just huddle together for cover — but you also can't push your
  opponent into a rock.
- Solo: the round ends when you blow up. You'll see your survival time,
  the wave you reached, and your best time (saved on this browser), with
  a "Fly Again" button.
- 2 Players: the round ends the moment either ship blows up (dying at the
  exact same instant is a draw). You'll see who won and the running score,
  with a "Next Round" button to keep playing.
- Every ~20 seconds the wave advances and asteroids spawn a bit faster and
  a bit thicker on the field, up to a cap.

IF A PHONE DISCONNECTS
------------------------
The field pauses automatically until the missing pilot reconnects — the
big screen shows a "Paused" banner. If a phone reloads mid-round it will
automatically rejoin its own ship (after a quick recalibration) rather
than starting a new one.

TESTING WITHOUT A PHONE
-------------------------
On the host screen's home page, under "No phone handy?", you can start a
keyboard-only Solo or 2-Player game — handy for a quick check that
everything works before you grab phones and go through the HTTPS/tunnel
setup. Pilot 1 uses WASD, Pilot 2 uses the arrow keys (solo mode accepts
either set).

WATCHING ALONG
---------------
The lobby screen also shows a "Watch live" QR code / link — anyone who
opens it (on another phone, tablet, etc.) gets a read-only view of the
field, hull counts, and score. No controls, just spectating.

SOUND
-----
Sound effects (impact, explosion, wave change, round end) are real
recorded samples embedded directly in the host page (no external audio
files needed), carried over from the original build.

PROJECT STRUCTURE
------------------
server.js              - Express + Socket.io server (rooms, lobby, tilt-input relay)
public/index.html       - Host display (the actual game / field screen)
public/controller.html  - Phone controller (tilt joystick + calibration)
public/watch.html       - Read-only spectator view
package.json            - Node dependencies

NOTES
-----
- Solo mode is one phone, one ship. 2-player mode seats the first two
  phones to join as Pilot 1 and Pilot 2; a third scan is told the room is
  full.
- If a phone disconnects mid-game (lock screen, browser backgrounded), it
  will automatically try to rejoin its own seat when it reconnects, and
  the field pauses in the meantime.
- If the host page is closed or refreshed, the room is torn down and the
  controllers/spectators are notified.
