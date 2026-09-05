import "server-only";
import {iowaEntryRulesQuestions} from "../iowaEntryRulesQuiz";

export const iowaEntryRulesAnswers:Record<string,{correct:string;explanation:string}>={
 q1:{correct:"C",explanation:"A team may have no more than 11 players on the field, including one goalkeeper."},
 q2:{correct:"B",explanation:"A match may not start or continue if either team has fewer than seven players."},
 q3:{correct:"D",explanation:"A standard match has two equal halves of 45 minutes, subject to competition rules and added time."},
 q4:{correct:"C",explanation:"The ball is out only when it has wholly crossed a touchline or goal line on the ground or in the air."},
 q5:{correct:"B",explanation:"A goal requires the whole ball to cross the goal line between the posts and under the crossbar, with no offence by the scoring team."},
 q6:{correct:"D",explanation:"A throw-in is awarded to the opponents of the player who last touched the ball."},
 q7:{correct:"B",explanation:"The thrower uses both hands from behind and over the head, with part of each foot on the touchline or on the ground outside it."},
 q8:{correct:"B",explanation:"All opponents must stand at least 2 m (2 yards) from the point on the touchline where the throw-in is taken."},
 q9:{correct:"C",explanation:"A goal kick is awarded when an attacker last touches the ball before it wholly crosses the goal line and no goal is scored."},
 q10:{correct:"A",explanation:"A corner kick is awarded when a defender last touches the ball before it wholly crosses the team's goal line and no goal is scored."},
 q11:{correct:"C",explanation:"Being in an offside position is not an offence by itself; the player must become involved in active play."},
 q12:{correct:"B",explanation:"There is no offside offence when a player receives the ball directly from a goal kick."},
 q13:{correct:"A",explanation:"A direct free kick may be kicked directly into the opponents' goal for a goal."},
 q14:{correct:"B",explanation:"The referee raises one arm above the head to show that the free kick is indirect."},
 q15:{correct:"C",explanation:"The penalty mark is 12 yards (11 m) from the midpoint between the goalposts."},
 q16:{correct:"A",explanation:"At least part of one goalkeeper foot must touch, be in line with, or be behind the goal line when the ball is kicked."},
 q17:{correct:"A",explanation:"A careless foul results in the appropriate free kick or penalty kick but normally does not require a card."},
 q18:{correct:"C",explanation:"A reckless challenge requires a caution shown with a yellow card."},
 q19:{correct:"D",explanation:"A challenge using excessive force and endangering safety requires a sending-off shown with a red card."},
 q20:{correct:"A",explanation:"A yellow card communicates that a player, substitute, substituted player or team official has been cautioned."},
 q21:{correct:"C",explanation:"A red card communicates a sending-off."},
 q22:{correct:"D",explanation:"All jewellery is forbidden and must be removed; using tape to cover jewellery is not permitted."},
 q23:{correct:"B",explanation:"Shinguards must be made of suitable material, provide reasonable protection and be covered by the socks."},
 q24:{correct:"C",explanation:"At a kick-off, the ball is in play when it is kicked and clearly moves."},
 q25:{correct:"C",explanation:"The goalkeeper handling a ball deliberately kicked to them by a teammate gives the opponents an indirect free kick."}
};

if(Object.keys(iowaEntryRulesAnswers).length!==iowaEntryRulesQuestions.length)throw new Error("Iowa rules quiz answer key is incomplete.");
