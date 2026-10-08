ROCK DRIFT — Meteor Dodging for 1–2 Pilots
===========================================

One screen (PC, TV, laptop) shows the meteor field. Each pilot flies a Dart
ship from their phone with a D-pad and a fire button. Rockets don't break
meteors — they burst on impact and shove the rock off its course, so you
can clear a path for yourself or push a rock into your opponent.

Part of the Shared Couch set (same look as Tank War, Math Duel, Counting
Clash and Naval Duel): Unbounded font, grey palette, QR-only lobby,
menus chosen from the phones, one phone = one slot.

SETUP
-----
Node.js 16 or newer.
    npm install
    npm start
Open http://localhost:3000 on the big screen. Phones must be on the same
Wi-Fi; the QR code automatically uses this computer's LAN IP. No HTTPS is
needed (the old motion-sensor controls are gone).

HOW TO PLAY
-----------
1. Big screen: choose 1 Player or 2 Players. A QR code appears.
2. Each pilot scans it, then taps Ready. Solo starts right away; 2 Players
   starts when both are ready. A 3-2-1 countdown follows.
3. Phone controls (landscape):
     D-pad up      thrust forward
     D-pad down    reverse
     D-pad left/right  turn
     Diagonals work (e.g. up + right = thrust while turning).
     Crosshair button  fire a rocket (hold to keep firing when reloaded)
4. Round over: the menu (Fly again / Next round / Back to lobby) is chosen
   from the phones: D-pad up/down + fire, or tap an item. Input is locked
   for 0.9 s after the menu opens. The host also takes arrows / Enter /
   mouse.

GAMEPLAY
--------
- 5 HP (top bar on the big screen, and on your own phone). A meteor hit
  costs 1 HP, with a short blinking grace period afterwards.
- Rockets: one shot, then a 0.55 s reload (bar under your HP: RELOAD →
  READY). 620 px/s. On impact the meteor's speed changes by
  ROCKET_PUSH / radius², so small rocks fly off and big rocks barely budge.
  A rocket that hits the other ship gives it a shove, no damage.
- Every 12 s the wave advances: more and faster meteors, up to 48.
- Solo: survive as long as you can; best time is saved on the big screen.
- 2 Players: the first ship destroyed loses the round (both at the same
  instant = draw). The score carries across rounds until Back to lobby.
- If a phone disconnects mid-round the field pauses until it's back. A
  phone that reloads goes straight back to its ship.

KEYBOARD TEST (no phones)
-------------------------
Links at the bottom of the home screen. Pilot A: WASD + Space.
Pilot B: arrows + Enter. Solo accepts both sets.

TUNING
------
Constants at the top of the script in public/index.html:
SHIP_SPEED, TURN_RATE, RELOAD_MS, ROCKET_SPEED, ROCKET_PUSH,
ROCKET_SHOVE, WAVE_DURATION, MAX_ROCKS.

PROJECT STRUCTURE
-----------------
server.js               Express + Socket.io (rooms, QR, slots, input relay)
public/index.html       Big screen (the game)
public/controller.html  Phone controller (D-pad + fire)
public/fonts/           Unbounded (SIL OFL, see OFL.txt)

SOCKET EVENTS
-------------
create_game {mode,origin,base} → game_created {code,mode,joinUrl,qrSvg}
join_game / rejoin_game {code,clientId} → joined {slot,code,mode} | join_error
replaced                         server → the phone's older tab
player_ready                     phone → server (starts when everyone is ready)
lobby_update {mode,A,B,readyA,readyB}
game_start                       server → host + phones
ctrl_input {up,down,left,right}  phone → host (on change + every 80 ms)
ctrl_fire                        phone → host (shoot, or select in menus)
ctrl_menu {index}                phone → host (tapped a menu item)
host_ui {menu,mode,eyebrow,title,winner,items,focus,locked} host → phones
to_player {slot,kind,data} → player_msg   hp / boom / round_start / round_over
host_back_to_lobby → back_to_lobby
close_game, player_left, player_joined, host_disconnected
