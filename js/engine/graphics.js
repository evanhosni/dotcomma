export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );
export const renderer = new THREE.WebGLRenderer();

export const sceneSetup = (()=>{
    
    //THREE
    renderer.setSize( window.innerWidth, window.innerHeight );
    document.body.appendChild( renderer.domElement );
    
	camera.rotation.order = 'YXZ';
    camera.position.z = 5;

    scene.background = new THREE.Color( 0x88ccee );
    
    function animate() {
        requestAnimationFrame( animate );
        renderer.render( scene, camera );
    }
    animate()


    //WINDOW RESIZE
    window.addEventListener( 'resize', onWindowResize, false );

    function onWindowResize(){
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize( window.innerWidth, window.innerHeight );
    }

})();
