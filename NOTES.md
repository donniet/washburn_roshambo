# Washburn Roshambo

Simulator for a game students are playing at a highschool.  The game involves bead necklaces.  All students receive a blue one, and all teachers receive a gold one.  The key rule is that after a game of paper-rock-scissors the best 2 out of 3 winner receives beads from the loser, but there are disagreements about the more subtle rules.

# Goal 

Visualize the outcome of the game (the distribution of blue and gold necklaces among students and staff) given different sets of rules.

# Initial conditions

* There are roughly 1600 students and roughly 150 staff, but these should be the defaults, and editable 
* All students start with a blue necklace, and all staff start with a gold necklace.  This should be configurable by limiting the number of blue and gold necklaces to a different number than the number of students, and randomly choosing the students and staff that receive a blue or gold necklace.
* Students are not allowed to disrupt class, so they can only play during passing time, or for a total of 25 minutes.  If each game takes 5 seconds to play, thats a maximum of 300 games that any one person can play.  This number should be configurable.

# Fixed Rules

Two people compete at rock-paper-scissors, and the best 2/3 winner will receive at least one necklace from the loser.

# Rule Variations

* The winner receives ALL the necklaces from the loser
* The winner receives a single necklace from the loser (chosen at random)
* The winner receives a GOLD necklace, and failing that a BLUE one
* THe winner receives a BLUE necklace, and failing that a GOLD one.
* Teachers CAN challenge students
* Teachers CANNOT challenge students
* Individuals with zero necklaces CANNOT challenge and are OUT
* Individuals with zero necklaces CAN challenge
* Teachers CAN challenge each other
* Teachers CANNOT challenge each other

# Strategies

* Challenges are randomly chosen
* (More challenges will be here in future iterations)

