export function Rules({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal" role="dialog" aria-label="Règles du jeu">
      <div className="modal-box rules">
        <div className="modal-head">
          <h2>Règles du jeu</h2>
          <button type="button" className="btn ghost" onClick={onClose}>
            Fermer
          </button>
        </div>
        <h3>Le paquet</h3>
        <p>
          31 cartes : Tchaka ♣, Zing ♦ et Koubi ♥ de 3 à 10, Black ♠ de 3 à 9. Du plus faible au plus fort : 3, 4, 5, 6, 7,
          8, 9, 10. Tables de 2 à 4 joueurs.
        </p>
        <h3>La manche</h3>
        <ul>
          <li>Chaque joueur reçoit 5 cartes (3 puis 2) et joue une carte par pli, 5 plis en tout.</li>
          <li>Le meneur pose la carte de son choix : son enseigne est l'enseigne demandée.</li>
          <li>Si vous avez l'enseigne demandée, vous devez la jouer. Sinon, jouez n'importe quelle carte.</li>
          <li>La plus forte carte de l'enseigne demandée gagne le pli, et son joueur mène le pli suivant.</li>
          <li>Le gagnant du 5e pli gagne la manche. La manche suivante commence par le joueur à sa gauche.</li>
          <li>Vous avez 30 secondes pour jouer, sinon vous êtes considéré comme ayant abandonné.</li>
        </ul>
        <h3>Gains</h3>
        <ul>
          <li>Victoire simple : chaque adversaire paie 1 × la mise.</li>
          <li>Korat (gagner le 5e pli avec un 3) : chaque adversaire paie 2 × la mise.</li>
          <li>Il faut au moins 2 × la mise pour jouer une manche.</li>
          <li>Le croupier prélève 10 % de ce que le vainqueur reçoit.</li>
        </ul>
        <h3>Victoires spéciales (dès la distribution, de la plus forte à la plus faible)</h3>
        <ol>
          <li>Brelan de 7 (trois 7) : simple</li>
          <li>Carré de 7 (les quatre 7) : Korat</li>
          <li>Total des 5 cartes = 16 : Korat</li>
          <li>Carré (quatre cartes de même valeur) : simple</li>
          <li>5 cartes de la même enseigne : simple</li>
          <li>Brelan de 3 : simple</li>
          <li>Total des 5 cartes entre 17 et 21 : simple</li>
        </ol>
        <p>À égalité, la plus petite somme gagne, puis le joueur servi en premier.</p>
        <h3>Abandon</h3>
        <p>
          Tout joueur peut abandonner à tout moment. Il paie 1 × la mise au vainqueur, même en cas de Korat. S'il ne reste
          qu'un joueur, il gagne la manche.
        </p>
        <p className="muted">Les crédits sont virtuels : ils n'ont aucune valeur et ne peuvent pas être échangés contre de l'argent.</p>
      </div>
    </div>
  );
}
