export const world = new CANNON.World();

export const sceneSetup = (()=>{

    //CANNON
    const timeStep=1/60;
    world.gravity.set(0,-9.81,0);
    world.broadphase = new CANNON.NaiveBroadphase();//unsure what this does
    world.solver.iterations = 10;//unsure what this does

    // var mass, body, shape;
    // shape = new CANNON.Box(new CANNON.Vec3(1,1,1));
    // mass = 1;
    // body = new CANNON.Body({
    // mass: 1
    // });
    // body.addShape(shape);
    // body.angularVelocity.set(0,10,0);
    // body.angularDamping = 0.5;
    // world.addBody(body);
    
    function animate() {
        world.step(timeStep);
        requestAnimationFrame( animate );
    }
    animate()

})();


/////TODO: the below is for plane/terrain collision. maybe do this in terrain functions instead?

import {scene} from "./graphics.js"
function collision() {
    
    for (let i = 0; i < scene.children.length; i++) {
        const obj = scene.children[i];
        if (obj.type == "Mesh" && obj.userData.collision != true && obj.geometry.type == "PlaneGeometry") {
            console.log(obj)
            obj.userData.collision = true;
        }
    }
    
    requestAnimationFrame( collision );
    
}
collision()